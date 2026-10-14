#include "OpfFarm.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <exception>
#include <utility>

#include <boost/filesystem/fstream.hpp>
#include <boost/filesystem/operations.hpp>
#include <boost/log/trivial.hpp>
#include <boost/system/error_code.hpp>
#include <nlohmann/json.hpp>
#include <wx/stdpaths.h>
#include <wx/utils.h>

#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "MainFrame.hpp"
#include "PartPlate.hpp"
#include "Plater.hpp"
#include "Tab.hpp"
#include "format.hpp"
#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "slic3r/Utils/Http.hpp"

namespace Slic3r {
namespace GUI {

namespace fs = boost::filesystem;
using nlohmann::json;

namespace {

const char* DEFAULT_FARM_URL = "http://127.0.0.1:7878/";

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
        else if (command == "opf_new_plate")
            new_plate(text("printer"), text("name"), text("machine"));
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

wxString OpfFarm::send_label() const
{
    if (m_target_name.empty())
        return _L("Send to farm");
    // TRN: The print button's label. %1% is the name of a printer in the farm, such as "A1 mini 2".
    return format_wxstr(_L("Send to %1%"), from_u8(m_target_name));
}

void OpfFarm::new_plate(const std::string& printer, const std::string& name, const std::string& machine)
{
    Plater* plater = wxGetApp().plater();
    // Start from an empty plate. Plater asks whether to save the open project first; Cancel keeps it.
    if (!plater->model().objects.empty() && plater->new_project() == wxID_CANCEL)
        return;
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
    plater->load_project(from_path(path), "<loadall>");
    // Still the old project: the user kept it when asked about saving it.
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
    Plater*        plater = wxGetApp().plater();
    PartPlateList& plates = plater->get_partplate_list();
    PartPlate*     plate  = plates.get_curr_plate();
    if (plate == nullptr || !plate->is_slice_result_ready_for_print()) {
        show_farm_error(_L("Slice the plate before sending it to the farm."));
        return;
    }
    const int   plate_idx = plates.get_curr_plate_index();
    std::string name      = plate->get_plate_name();
    if (name.empty()) {
        name = into_u8(plater->get_project_name());
        if (plates.get_plate_count() > 1)
            name += " #" + std::to_string(plate_idx + 1);
    }

    const std::string base = file_name(name);
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
    if (plater->export_3mf(sliced, SaveStrategy::Silence | SaveStrategy::SplitModel | SaveStrategy::WithGcode | SaveStrategy::SkipModel,
                           plate_idx) != 0 ||
        !plater->export_3mf_copy(project)) {
        show_farm_error(_L("The plate could not be saved for sending to the farm."));
        return;
    }

    auto http = Http::post(into_u8(farm_url()) + "api/v1/ui/plates");
    http.form_add("name", name).form_add("plate", std::to_string(plate_idx + 1));
    if (const std::string job = editing_job(); !job.empty())
        http.form_add("replace", job);
    if (!m_target_printer.empty())
        http.form_add("printer", m_target_printer);
    http.form_add_file("file", sliced, base + ".gcode.3mf")
        .form_add_file("project", project, base + ".3mf")
        .timeout_max(300)
        .on_complete([this](std::string body, unsigned) {
            wxGetApp().CallAfter([this, body = std::move(body)] {
                m_sending = false;
                on_sent(body);
            });
        })
        .on_error([this](std::string body, std::string error, unsigned status) {
            wxGetApp().CallAfter([this, body = std::move(body), error = std::move(error), status] {
                m_sending = false;
                show_farm_error(farm_error(body, error, status));
            });
        });
    m_sending = true;
    http.perform();
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
