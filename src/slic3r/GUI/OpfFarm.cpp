#include "OpfFarm.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <exception>
#include <map>
#include <set>
#include <utility>

#include <boost/algorithm/string/case_conv.hpp>
#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem/fstream.hpp>
#include <boost/filesystem/operations.hpp>
#include <boost/log/trivial.hpp>
#include <boost/system/error_code.hpp>
#include <nlohmann/json.hpp>
#include <wx/stdpaths.h>
#include <wx/utils.h>

#include "Event.hpp"
#include "GLToolbar.hpp"
#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "MainFrame.hpp"
#include "PartPlate.hpp"
#include "Plater.hpp"
#include "Tab.hpp"
#include "format.hpp"
#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/Utils/Http.hpp"

namespace Slic3r {
namespace GUI {

namespace fs = boost::filesystem;
using nlohmann::json;

namespace {

const char* DEFAULT_FARM_URL = "http://127.0.0.1:7878/";

// The farm program the installer puts in the "farm" folder next to the slicer.
#ifdef _WIN32
const char* OPF_FARM_EXE = "OPF-Farm.exe";
#else
const char* OPF_FARM_EXE = "OPF-Farm";
#endif

// OPF's ids are letters and digits. Nothing else goes into a file path or an address.
bool valid_id(const std::string& id)
{
    return !id.empty() && id.size() <= 64 &&
           std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::isalnum(c) || c == '-' || c == '_'; });
}

// A plate name made safe to use as a file name.
std::string file_name(const std::string& name)
{
    std::string out;
    for (unsigned char c : name)
        out += (c < 32 || std::strchr("<>:\"/\\|?*", c) != nullptr) ? '_' : static_cast<char>(c);
    if (out.size() > 80) {
        out.resize(80);
        // Not in the middle of a UTF-8 character.
        while (!out.empty() && (static_cast<unsigned char>(out.back()) & 0x80) != 0)
            out.pop_back();
    }
    while (!out.empty() && (out.back() == ' ' || out.back() == '.'))
        out.pop_back();
    return out.empty() ? std::string("plate") : out;
}

fs::path work_dir(const std::string& a, const std::string& b = std::string())
{
    fs::path dir = fs::temp_directory_path() / "opf" / a;
    if (!b.empty())
        dir /= b;
    fs::create_directories(dir);
    return dir;
}

bool same_file(const fs::path& a, const fs::path& b)
{
    boost::system::error_code ec;
    return !a.empty() && !b.empty() && fs::equivalent(a, b, ec) && !ec;
}

// OPF's settings folder: Electron's user data folder for the app named OPF.
fs::path opf_data_dir()
{
#ifdef _WIN32
    wxString appdata;
    if (!wxGetEnv("APPDATA", &appdata) || appdata.empty())
        return {};
    return into_path(appdata) / "OPF";
#elif defined(__APPLE__)
    return into_path(wxGetHomeDir()) / "Library" / "Application Support" / "OPF";
#else
    wxString config;
    if (!wxGetEnv("XDG_CONFIG_HOME", &config) || config.empty())
        return into_path(wxGetHomeDir()) / ".config" / "OPF";
    return into_path(config) / "OPF";
#endif
}

// What went wrong talking to the farm, from OPF's {"ok":false,"error":"..."} answer when there is one.
wxString farm_error(const std::string& body, const std::string& error, unsigned status)
{
    if (status == 0)
        return _L("OPF is not running. Open the Farm tab to start it, then try again.");
    try {
        const json answer = json::parse(body);
        if (answer.is_object() && answer.contains("error") && answer["error"].is_string())
            return from_u8(answer["error"].get<std::string>());
    } catch (const std::exception&) {
        // Not OPF's answer: say what the server said.
    }
    // TRN: %1% is an HTTP status code such as 404, %2% the server's own message.
    return format_wxstr(_L("The farm answered with error %1%. %2%"), status, from_u8(error));
}

void show_farm_error(const wxString& message)
{
    show_error(wxGetApp().mainframe, message);
}

// The name a plate goes to the farm with: its own, or the project's when the project was saved under a
// name. A project that was never saved has none ("Untitled", in any language): it goes without one, and
// the farm names the plate after its first part.
std::string name_for_farm(Plater* plater, int plate_idx)
{
    PartPlateList& plates = plater->get_partplate_list();
    PartPlate*     plate  = plates.get_plate(plate_idx);
    std::string    name   = plate != nullptr ? plate->get_plate_name() : std::string();
    if (name.empty() && !plater->get_project_filename(".3mf").empty()) {
        name = into_u8(plater->get_project_name());
        if (plates.get_plate_count() > 1)
            name += " #" + std::to_string(plate_idx + 1);
    }
    return name;
}

// One plate the way printers take it: what Export plate sliced file writes.
bool export_sliced_plate(Plater* plater, int plate_idx, const fs::path& path)
{
    return plater->export_3mf(path, SaveStrategy::Silence | SaveStrategy::SplitModel | SaveStrategy::WithGcode | SaveStrategy::SkipModel,
                              plate_idx) == 0;
}

// The profile bundle a model's printer profile is in: "Bambu Lab A1 mini" is in BBL, and most others are in a
// bundle named after the maker ("Anycubic Kobra 3 Max" in Anycubic). Empty when there is none.
std::string vendor_of(const std::string& model)
{
    if (boost::algorithm::starts_with(model, "Bambu Lab "))
        return "BBL";
    const std::string         maker = model.substr(0, model.find(' '));
    boost::system::error_code ec;
    return !maker.empty() && fs::exists(fs::path(resources_dir()) / "profiles" / (maker + ".json"), ec) ? maker : std::string();
}

} // namespace

OpfFarm& OpfFarm::get()
{
    static OpfFarm farm;
    return farm;
}

wxString OpfFarm::farm_url()
{
    std::string url = wxGetApp().app_config->get("opf_farm_url");
    if (url.empty())
        url = DEFAULT_FARM_URL;
    if (url.back() != '/')
        url += '/';
    return from_u8(url);
}

wxString OpfFarm::page_url(const std::string& view)
{
    return farm_url() + "?embed=" + from_u8(view) + "&theme=" + (wxGetApp().dark_mode() ? "dark" : "light");
}

void OpfFarm::on_page_message(const wxString& message)
{
    try {
        const json msg = json::parse(into_u8(message));
        if (!msg.is_object())
            return;
        auto text = [&msg](const char* key) {
            const auto it = msg.find(key);
            return it != msg.end() && it->is_string() ? it->get<std::string>() : std::string();
        };
        const std::string command = text("command");
        if (command == "opf_edit_plate") {
            const auto plate = msg.find("plate");
            edit_plate(text("job"), text("name"), plate != msg.end() && plate->is_number_integer() ? plate->get<int>() : 1);
        } else if (command == "opf_target")
            set_target(text("printer"), text("name"));
        else if (command == "opf_online") {
            m_online.clear();
            const auto list = msg.find("printers");
            if (list != msg.end() && list->is_array())
                for (const json& p : *list)
                    if (p.is_object() && p.contains("id") && p["id"].is_string() && valid_id(p["id"].get<std::string>()) &&
                        p.contains("name") && p["name"].is_string() && p.contains("model") && p["model"].is_string())
                        m_online.push_back({p["id"].get<std::string>(), p["name"].get<std::string>(), p["model"].get<std::string>()});
            if (MainFrame* frame = wxGetApp().mainframe)
                frame->refresh_send_to_farm();
        } else if (command == "opf_new_plate")
            new_plate(text("printer"), text("name"), text("machine"));
        else if (command == "opf_printers") {
            // The farm's printers: each one's printer profile is set up here too, so a printer is added once.
            std::vector<std::pair<std::string, std::string>> machines;
            const auto                                       list = msg.find("machines");
            if (list != msg.end() && list->is_array())
                for (const json& m : *list)
                    if (m.is_object() && m.contains("model") && m["model"].is_string() && m.contains("preset") && m["preset"].is_string())
                        machines.emplace_back(m["model"].get<std::string>(), m["preset"].get<std::string>());
            if (!machines.empty())
                wxGetApp().CallAfter([this, machines] { install_printers(machines); });
        }
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(warning) << "OPF: unreadable message from the farm page: " << e.what();
    }
}

void OpfFarm::set_target(const std::string& printer, const std::string& name)
{
    m_target_printer = valid_id(printer) ? printer : std::string();
    m_target_name    = m_target_printer.empty() ? std::string() : name;
    if (MainFrame* frame = wxGetApp().mainframe)
        frame->refresh_send_to_farm();
}

std::pair<std::string, std::string> OpfFarm::destination() const
{
    if (!m_target_printer.empty())
        return {m_target_printer, m_target_name};
    // With none picked the farm puts a plate on a printer of the model it was sliced for, so when only one
    // printer of that model can take it, that is where it goes.
    const auto* opt = wxGetApp().preset_bundle->printers.get_edited_preset().config.option<ConfigOptionString>("printer_model");
    const std::string    model = opt != nullptr ? boost::algorithm::to_lower_copy(opt->value) : std::string();
    const OnlinePrinter* found = nullptr;
    for (const OnlinePrinter& p : m_online)
        if (!model.empty() && boost::algorithm::to_lower_copy(p.model) == model) {
            if (found != nullptr)
                return {};
            found = &p;
        }
    return found != nullptr ? std::make_pair(found->id, found->name) : std::pair<std::string, std::string>();
}

wxString OpfFarm::send_label() const
{
    const std::string name = destination().second;
    if (name.empty())
        return _L("Send plate to farm");
    // TRN: The print button's label. %1% is the name of a printer in the farm, such as "A1 mini 2".
    return format_wxstr(_L("Send plate to %1%"), from_u8(name));
}

void OpfFarm::new_plate(const std::string& printer, const std::string& name, const std::string& machine)
{
    Plater* plater = wxGetApp().plater();
    // Start from an empty plate, without asking about the one before: it went to the farm, or can be
    // saved with File > Save first.
    plater->new_project(true, true);
    m_editing_job.clear();
    m_editing_path.clear();
    set_target(printer, name);
    // The printer's own profile, when the farm knows it and it is installed here.
    if (!machine.empty() && wxGetApp().preset_bundle->printers.find_preset(machine) != nullptr)
        if (Tab* tab = wxGetApp().get_tab(Preset::TYPE_PRINTER))
            tab->select_preset(machine);
    wxGetApp().mainframe->select_tab(TAB_ID_PREPARE);
}

void OpfFarm::edit_plate(const std::string& job, const std::string& name, int plate)
{
    if (!valid_id(job))
        return;
    fs::path path;
    try {
        path = work_dir("edit", job) / (file_name(name) + ".3mf");
    } catch (const std::exception& e) {
        show_farm_error(from_u8(e.what()));
        return;
    }
    Http::get(into_u8(farm_url()) + "api/v1/ui/plates/" + job + "/project")
        .timeout_max(300)
        .on_complete([this, job, path, plate](std::string body, unsigned) {
            wxGetApp().CallAfter([this, job, path, plate, body = std::move(body)] {
                boost::filesystem::ofstream file(path, std::ios::binary | std::ios::trunc);
                file.write(body.data(), static_cast<std::streamsize>(body.size()));
                file.close();
                if (!file) {
                    show_farm_error(_L("The plate's project could not be saved on this computer."));
                    return;
                }
                open_project(job, path, plate);
            });
        })
        .on_error([](std::string body, std::string error, unsigned status) {
            wxGetApp().CallAfter([body = std::move(body), error = std::move(error), status] {
                show_farm_error(farm_error(body, error, status));
            });
        })
        .perform();
}

void OpfFarm::open_project(const std::string& job, const fs::path& path, int plate)
{
    Plater* plater = wxGetApp().plater();
    // As for a new plate: no questions about what was open.
    plater->new_project(true, true);
    plater->load_project(from_path(path), "<loadall>");
    // Not opened: the file could not be read.
    if (!same_file(into_path(plater->get_project_filename(".3mf")), path))
        return;
    m_editing_job  = job;
    m_editing_path = path;
    if (plate >= 1 && plate <= plater->get_partplate_list().get_plate_count())
        plater->select_plate(plate - 1);
    wxGetApp().mainframe->select_tab(TAB_ID_PREPARE);
}

std::string OpfFarm::editing_job() const
{
    if (m_editing_job.empty())
        return {};
    return same_file(into_path(wxGetApp().plater()->get_project_filename(".3mf")), m_editing_path) ? m_editing_job : std::string();
}

void OpfFarm::send_current_plate()
{
    if (m_sending)
        return;
    m_send_all_waiting = false;
    Plater*        plater = wxGetApp().plater();
    PartPlateList& plates = plater->get_partplate_list();
    PartPlate*     plate  = plates.get_curr_plate();
    if (plate == nullptr || !plate->is_slice_result_ready_for_print()) {
        show_farm_error(_L("Slice the plate before sending it to the farm."));
        return;
    }
    const int         plate_idx = plates.get_curr_plate_index();
    const std::string name      = name_for_farm(plater, plate_idx);
    const std::string base      = file_name(name);
    fs::path          sliced, project;
    try {
        const fs::path dir = work_dir("send");
        sliced             = dir / (base + ".gcode.3mf");
        project            = dir / (base + ".3mf");
    } catch (const std::exception& e) {
        show_farm_error(from_u8(e.what()));
        return;
    }
    // The plate the way printers take it (what Export plate sliced file writes), and the whole project
    // to open again from the queue.
    if (!export_sliced_plate(plater, plate_idx, sliced) || !plater->export_3mf_copy(project)) {
        show_farm_error(_L("The plate could not be saved for sending to the farm."));
        return;
    }
    m_sending = true;
    upload_plate(plate_idx, name, sliced, project, true,
                 [this](const std::string& body) {
                     m_sending = false;
                     on_sent(body);
                 },
                 [this](const wxString& error) {
                     m_sending = false;
                     show_farm_error(error);
                 });
}

void OpfFarm::upload_plate(int plate_idx, const std::string& name, const fs::path& sliced, const fs::path& project, bool replace_edited,
                           std::function<void(const std::string& body)> done, std::function<void(const wxString& error)> failed)
{
    const std::string base = file_name(name);
    auto              http = Http::post(into_u8(farm_url()) + "api/v1/ui/plates");
    http.form_add("name", name).form_add("plate", std::to_string(plate_idx + 1));
    if (replace_edited)
        if (const std::string job = editing_job(); !job.empty())
            http.form_add("replace", job);
    if (const std::string printer = destination().first; !printer.empty())
        http.form_add("printer", printer);
    http.form_add_file("file", sliced, base + ".gcode.3mf")
        .form_add_file("project", project, base + ".3mf")
        .timeout_max(300)
        .on_complete([done](std::string body, unsigned) { wxGetApp().CallAfter([done, body = std::move(body)] { done(body); }); })
        .on_error([failed](std::string body, std::string error, unsigned status) {
            wxGetApp().CallAfter([failed, body = std::move(body), error = std::move(error), status] { failed(farm_error(body, error, status)); });
        });
    http.perform();
}

wxString OpfFarm::send_all_label() const
{
    const std::string name = destination().second;
    if (name.empty())
        return _L("Send all plates to farm");
    // TRN: The print button's label. %1% is the name of a printer in the farm, such as "A1 mini 2".
    return format_wxstr(_L("Send all plates to %1%"), from_u8(name));
}

void OpfFarm::send_all_plates()
{
    if (m_sending)
        return;
    Plater*        plater = wxGetApp().plater();
    PartPlateList& plates = plater->get_partplate_list();
    if (plates.is_all_slice_results_ready_for_print()) {
        start_sending_all();
        return;
    }
    // Slice every plate first; slicing_finished() sends them once the last one is done.
    m_send_all_waiting = true;
    m_send_all_asked   = std::chrono::steady_clock::now();
    wxPostEvent(plater, SimpleEvent(EVT_GLTOOLBAR_SLICE_ALL));
    wxGetApp().mainframe->select_tab(TAB_ID_PREVIEW);
}

void OpfFarm::slicing_finished()
{
    if (!m_send_all_waiting)
        return;
    m_send_all_waiting = false;
    // Slice all that never finished and a later, ordinary slice must not send everything by surprise.
    if (std::chrono::steady_clock::now() - m_send_all_asked > std::chrono::minutes(30))
        return;
    if (!wxGetApp().plater()->get_partplate_list().is_all_slice_results_ready_for_print()) {
        show_farm_error(_L("Not every plate could be sliced, so none were sent. Check the plates with a warning, then send them again."));
        return;
    }
    start_sending_all();
}

void OpfFarm::start_sending_all()
{
    Plater*        plater = wxGetApp().plater();
    PartPlateList& plates = plater->get_partplate_list();
    m_send_queue.clear();
    m_sent_jobs.clear();
    m_sent_printers.clear();
    for (int i = 0; i < plates.get_plate_count(); ++i) {
        PartPlate* plate = plates.get_plate(i);
        if (plate != nullptr && plate->is_slice_result_ready_for_print() && plate->has_printable_instances())
            m_send_queue.push_back(i);
    }
    if (m_send_queue.empty()) {
        show_farm_error(_L("There is nothing on the plates to send."));
        return;
    }
    // The whole project goes with every plate, so each one opens again from its queue.
    try {
        const fs::path dir = work_dir("send", "all");
        m_send_project     = dir / (file_name(into_u8(plater->get_project_name())) + ".3mf");
    } catch (const std::exception& e) {
        show_farm_error(from_u8(e.what()));
        return;
    }
    if (!plater->export_3mf_copy(m_send_project)) {
        show_farm_error(_L("The project could not be saved for sending to the farm."));
        return;
    }
    m_sending = true;
    send_next_of_all();
}

void OpfFarm::send_next_of_all()
{
    if (m_send_queue.empty()) {
        finish_sending_all(wxString());
        return;
    }
    Plater*           plater    = wxGetApp().plater();
    const int         plate_idx = m_send_queue.front();
    const std::string name      = name_for_farm(plater, plate_idx);
    fs::path          sliced;
    try {
        sliced = work_dir("send", "all") / (file_name(name) + "-" + std::to_string(plate_idx + 1) + ".gcode.3mf");
    } catch (const std::exception& e) {
        finish_sending_all(from_u8(e.what()));
        return;
    }
    if (!export_sliced_plate(plater, plate_idx, sliced)) {
        // TRN: %1% is a plate number.
        finish_sending_all(format_wxstr(_L("Plate %1% could not be saved for sending to the farm."), plate_idx + 1));
        return;
    }
    upload_plate(plate_idx, name, sliced, m_send_project, false,
                 [this](const std::string& body) {
                     try {
                         const json value = json::parse(body).at("value");
                         m_sent_jobs.push_back(value.at("job").at("id").get<std::string>());
                         const json& printer = value.at("printer");
                         m_sent_printers.push_back(printer.contains("name") && printer["name"].is_string() ? printer["name"].get<std::string>() : std::string());
                     } catch (const std::exception&) {
                         m_sent_printers.push_back(std::string());
                     }
                     m_send_queue.erase(m_send_queue.begin());
                     send_next_of_all();
                 },
                 [this](const wxString& error) { finish_sending_all(error); });
}

void OpfFarm::finish_sending_all(const wxString& error)
{
    m_sending = false;
    m_send_queue.clear();
    const size_t sent = m_sent_printers.size();
    if (!error.empty()) {
        // TRN: %1% is how many plates were sent before it stopped, %2% what went wrong.
        show_farm_error(sent ? format_wxstr(_L("%1% plates were sent, then sending stopped: %2%"), sent, error) : error);
        if (sent == 0)
            return;
    }
    // How many went to which printer, in the farm page: "Sent 5 plates: A1 mini 2 ×3, A1 ×2".
    std::vector<std::pair<std::string, int>> counts;
    for (const std::string& printer : m_sent_printers) {
        auto it = std::find_if(counts.begin(), counts.end(), [&printer](const auto& c) { return c.first == printer; });
        if (it == counts.end())
            counts.emplace_back(printer, 1);
        else
            ++it->second;
    }
    std::string where;
    for (const auto& [printer, n] : counts) {
        if (printer.empty())
            continue;
        where += (where.empty() ? ": " : ", ") + printer + (n > 1 ? " \xC3\x97" + std::to_string(n) : std::string());
    }
    // TRN: %1% is a number of plates, %2% the printers they went to, such as ": A1 mini 2 ×3, A1 ×2".
    const wxString text = format_wxstr(_L_PLURAL("Sent %1% plate%2%", "Sent %1% plates%2%", sent), sent, from_u8(where));
    MainFrame*     frame = wxGetApp().mainframe;
    frame->select_tab(TAB_ID_FARM);
    if (!m_sent_jobs.empty())
        frame->run_farm_script(from_u8("window.opfShowJob && window.opfShowJob(" + json(m_sent_jobs.front()).dump() + ")"));
    frame->run_farm_script(from_u8("window.opfToast && window.opfToast(" + json(into_u8(text)).dump() + ")"));
}

void OpfFarm::sync_filaments()
{
    const std::string printer = destination().first;
    if (printer.empty()) {
        show_info(wxGetApp().mainframe, _L("Pick a printer in the Farm tab first. Sync then fills the filaments with what is loaded in it."),
                  _L("Sync filaments with the farm"));
        return;
    }
    Http::get(into_u8(farm_url()) + "api/v1/ui/printers/" + printer + "/filaments")
        .timeout_max(20)
        .on_complete([this, printer](std::string body, unsigned) {
            wxGetApp().CallAfter([this, printer, body = std::move(body)] { apply_filaments(printer, body); });
        })
        .on_error([](std::string body, std::string error, unsigned status) {
            wxGetApp().CallAfter([body = std::move(body), error = std::move(error), status] { show_farm_error(farm_error(body, error, status)); });
        })
        .perform();
}

void OpfFarm::apply_filaments(const std::string& printer, const std::string& body)
{
    auto text = [](const json& j, const char* key) {
        const auto it = j.find(key);
        return it != j.end() && it->is_string() ? it->get<std::string>() : std::string();
    };
    std::map<int, DynamicPrintConfig> list;
    std::string                       printer_name;
    bool                              any = false;
    try {
        const json value = json::parse(body).at("value");
        printer_name     = text(value.at("printer"), "name");
        int index        = 0;
        for (const json& slot : value.at("slots")) {
            const std::string colour   = text(slot, "color");
            const std::string type     = text(slot, "type").empty() ? text(slot, "material") : text(slot, "type");
            const bool        loaded   = !colour.empty() || !type.empty();
            std::string       id       = text(slot, "filamentId");
            // A slot the farm knows something about, without Bambu's own id: OrcaSlicer's sync then picks the
            // generic preset of its material.
            if (loaded && id.empty())
                id = "OPF";
            const int unit = slot.contains("unit") && slot["unit"].is_number_integer() ? slot["unit"].get<int>() : 0;
            const int pos  = slot.contains("slot") && slot["slot"].is_number_integer() ? slot["slot"].get<int>() : 0;
            DynamicPrintConfig tray;
            tray.set_key_value("filament_id", new ConfigOptionStrings{loaded ? id : std::string()});
            tray.set_key_value("tag_uid", new ConfigOptionStrings{std::string()});
            tray.set_key_value("ams_id", new ConfigOptionStrings{std::to_string(unit < 0 ? 255 : unit)});
            tray.set_key_value("slot_id", new ConfigOptionStrings{std::to_string(pos)});
            tray.set_key_value("filament_type", new ConfigOptionStrings{type});
            tray.set_key_value("tray_name", new ConfigOptionStrings{unit < 0 ? std::string("Ext") : std::string(1, char('A' + unit % 26)) + std::to_string(pos + 1)});
            tray.set_key_value("filament_colour", new ConfigOptionStrings{colour.empty() ? std::string("#CECECE") : colour});
            tray.set_key_value("filament_multi_colour", new ConfigOptionStrings{});
            tray.set_key_value("filament_colour_type", new ConfigOptionStrings{std::string("1")});
            tray.set_key_value("filament_exist", new ConfigOptionBools{loaded});
            tray.set_key_value("filament_slot_placeholder", new ConfigOptionBools{false});
            tray.set_key_value("filament_is_support", new ConfigOptionBools{false});
            list.emplace(index++, std::move(tray));
            any = any || loaded;
        }
    } catch (const std::exception&) {
        show_farm_error(_L("The farm's answer about the filaments could not be read."));
        return;
    }
    if (!any) {
        // TRN: %1% is the name of a printer in the farm.
        show_info(wxGetApp().mainframe, format_wxstr(_L("The farm does not know of any filament loaded in %1%."), from_u8(printer_name)),
                  _L("Sync filaments with the farm"));
        return;
    }
    wxGetApp().sidebar().sync_ams_list_from_farm(std::move(list), "opf:" + printer);
}

void OpfFarm::install_printers(const std::vector<std::pair<std::string, std::string>>& machines)
{
    PresetBundle* bundle = wxGetApp().preset_bundle;
    AppConfig*    config = wxGetApp().app_config;
    if (bundle == nullptr || config == nullptr)
        return;
    std::map<std::string, std::map<std::string, std::set<std::string>>> add;
    std::string                                                         first_model, first_variant;
    for (const auto& [model, preset] : machines) {
        const Preset* existing = bundle->printers.find_preset(preset);
        if (preset.empty() || (existing != nullptr && existing->is_visible))
            continue;
        const std::string vendor = vendor_of(model);
        if (vendor.empty())
            continue;
        // "Bambu Lab A1 mini 0.4 nozzle": the nozzle is the model's variant.
        std::string variant = "0.4";
        const std::string tail = " nozzle";
        if (boost::algorithm::ends_with(preset, tail)) {
            const std::string rest = preset.substr(0, preset.size() - tail.size());
            const size_t      at   = rest.rfind(' ');
            if (at != std::string::npos)
                variant = rest.substr(at + 1);
        }
        add[vendor][model].insert(variant);
        if (first_model.empty()) {
            first_model   = model;
            first_variant = variant;
        }
    }
    if (add.empty())
        return;
    BOOST_LOG_TRIVIAL(info) << "OPF: setting up printer profiles for the farm's printers, first " << first_model << " " << first_variant;
    // The first printer of a new installation becomes the one Prepare starts with.
    const bool fresh = bundle->printers.only_default_printers();
    if (!bundle->apply_vendor_config(add, {}, config, false, fresh ? first_model : std::string(), fresh ? first_variant : std::string())) {
        BOOST_LOG_TRIVIAL(warning) << "OPF: could not set up the printer profiles";
        return;
    }
    // The filaments each printer comes with, as the setup wizard ticks them.
    std::map<std::string, std::string> filaments;
    for (const auto& [vendor, models] : add) {
        const auto v = bundle->vendors.find(vendor);
        if (v == bundle->vendors.end())
            continue;
        for (const auto& m : v->second.models)
            if (models.count(m.id) != 0)
                for (const std::string& f : m.default_materials)
                    filaments[f] = "true";
    }
    if (!filaments.empty())
        bundle->apply_vendor_config(add, filaments, config, false, fresh ? first_model : std::string(), fresh ? first_variant : std::string());
    wxGetApp().load_current_presets();
}

void OpfFarm::on_sent(const std::string& body)
{
    std::string job;
    try {
        job = json::parse(body).at("value").at("job").at("id").get<std::string>();
    } catch (const std::exception&) {
        show_farm_error(_L("The farm did not say where the plate went. Look for it in the Farm tab."));
        return;
    }
    // Show it in its printer's queue.
    MainFrame* frame = wxGetApp().mainframe;
    frame->select_tab(TAB_ID_FARM);
    frame->run_farm_script(from_u8("window.opfShowJob && window.opfShowJob(" + json(job).dump() + ")"));
}

OpfFarm::OpfFarm()
{
    // Opened by OPF's launcher, which has just started the farm: it is on its way.
    wxString starting;
    if (wxGetEnv("OPF_FARM_STARTING", &starting) && starting == "1")
        m_started_at = std::chrono::steady_clock::now();
}

void OpfFarm::record_slicer()
{
    // OPF's desktop icon opens the slicer, with the farm running in the background, once it knows where
    // the slicer is.
    try {
        const fs::path dir = opf_data_dir();
        if (dir.empty())
            return;
        fs::create_directories(dir);
        boost::filesystem::ofstream file(dir / "slicer.json", std::ios::trunc);
        file << json{{"exe", into_u8(wxStandardPaths::Get().GetExecutablePath())}}.dump(2);
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(warning) << "OPF: could not record where the slicer is: " << e.what();
    }
}

bool OpfFarm::start_service()
{
    const auto now = std::chrono::steady_clock::now();
    if (m_started_at != std::chrono::steady_clock::time_point{} && now - m_started_at < std::chrono::minutes(2))
        return true;
    // Written by OPF each time it starts: the Node.js its launcher runs with and the launcher script.
    std::string node, script;
    try {
        boost::filesystem::ifstream file(opf_data_dir() / "launcher.json");
        if (file) {
            const json launcher = json::parse(file);
            node                = launcher.value("node", "");
            script              = launcher.value("script", "");
        }
    } catch (const std::exception&) {
        node.clear();
        script.clear();
    }
    // Installed with the slicer: the farm program in the "farm" folder next to it.
    if (node.empty() || script.empty()) {
        const fs::path farm = into_path(wxStandardPaths::Get().GetExecutablePath()).parent_path() / "farm" / OPF_FARM_EXE;
        boost::system::error_code ec;
        if (fs::exists(farm, ec)) {
            const wxString command = "\"" + from_path(farm) + "\" --background";
            if (wxExecute(command, wxEXEC_ASYNC | wxEXEC_HIDE_CONSOLE) <= 0) {
                BOOST_LOG_TRIVIAL(warning) << "OPF: could not start " << into_u8(command);
                return false;
            }
            BOOST_LOG_TRIVIAL(info) << "OPF: starting the farm service: " << into_u8(command);
            m_started_at = now;
            return true;
        }
    }
    // Not written yet (OPF has not run since it was updated): OPF where it is usually kept, the "opf"
    // folder in Documents, and Node.js from the PATH.
    if (node.empty() || script.empty()) {
        const fs::path documents = into_path(wxStandardPaths::Get().GetDocumentsDir());
        for (const fs::path& root : {documents / "opf", into_path(wxGetHomeDir()) / "Documents" / "opf", into_path(wxGetHomeDir()) / "opf"}) {
            boost::system::error_code ec;
            if (fs::exists(root / "scripts" / "launch.cjs", ec)) {
                node   = "node";
                script = (root / "scripts" / "launch.cjs").string();
                break;
            }
        }
    }
    if (node.empty() || script.empty())
        return false;
    // It brings OPF up to date, starts it without a window and exits.
    const wxString command = "\"" + from_u8(node) + "\" \"" + from_u8(script) + "\" --background";
    if (wxExecute(command, wxEXEC_ASYNC | wxEXEC_HIDE_CONSOLE) <= 0) {
        BOOST_LOG_TRIVIAL(warning) << "OPF: could not start " << into_u8(command);
        return false;
    }
    BOOST_LOG_TRIVIAL(info) << "OPF: starting the farm service: " << into_u8(command);
    m_started_at = now;
    return true;
}

} // namespace GUI
} // namespace Slic3r
