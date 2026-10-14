#ifndef slic3r_OpfFarm_hpp_
#define slic3r_OpfFarm_hpp_

#include <chrono>
#include <string>

#include <boost/filesystem/path.hpp>
#include <wx/string.h>

namespace Slic3r {
namespace GUI {

// OPF: the slicer's side of the OPF farm service (https://github.com/Artis-98/opf), which runs on this
// computer and keeps the printers, their queues and the timeline. The Farm and Timeline tabs show its
// web page, which asks the slicer to open a queued plate for editing; Send to farm puts the sliced
// plate in a printer's queue. Each plate goes to the farm with its project, so it can be opened again.
class OpfFarm
{
public:
    static OpfFarm& get();

    // Address of the farm service, ending in '/': the "opf_farm_url" app config key, or this computer.
    static wxString farm_url();
    // The farm page for one tab; view is "farm" or "timeline".
    static wxString page_url(const std::string& view);

    // A message from the farm page (window.wx.postMessage).
    void on_page_message(const wxString& message);

    // Sends the current plate, sliced, with its project to the farm. A plate opened from a queue
    // replaces the one it was opened from.
    void send_current_plate();
    // The print button's label for Send to farm.
    wxString send_label() const;

    // Starts the farm service without a window, through OPF's launcher. True when it is starting; false
    // when OPF is not found on this computer.
    bool start_service();
    // Tells OPF where this slicer is, so OPF's desktop icon opens it.
    void record_slicer();

private:
    OpfFarm();

    void edit_plate(const std::string& job, const std::string& name, int plate);
    void open_project(const std::string& job, const boost::filesystem::path& path, int plate);
    void new_plate(const std::string& printer, const std::string& name, const std::string& machine);
    void set_target(const std::string& printer, const std::string& name);
    void on_sent(const std::string& body);
    // The queued plate the open project was opened from, while it is still that project.
    std::string editing_job() const;

    std::string                           m_target_printer;
    std::string                           m_target_name;
    std::string                           m_editing_job;
    boost::filesystem::path               m_editing_path;
    bool                                  m_sending{false};
    std::chrono::steady_clock::time_point m_started_at{};
};

} // namespace GUI
} // namespace Slic3r

#endif
