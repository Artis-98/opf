#ifndef slic3r_FarmPanel_hpp_
#define slic3r_FarmPanel_hpp_

#include <string>

#include <wx/panel.h>
#include <wx/string.h>

class wxWebView;
class wxWebViewEvent;

namespace Slic3r {
namespace GUI {

// OPF: the Farm and Timeline tabs. Each shows one view of the OPF farm service's web page (the
// printers on their shelves with their queues, or the timeline); see OpfFarm. While the service is
// not answering, the tab starts it if it can, says so, and keeps retrying.
class FarmPanel : public wxPanel
{
public:
    // view: "farm" or "timeline".
    FarmPanel(wxWindow* parent, std::string view);
    ~FarmPanel() override;

    bool Show(bool show = true) override;
    void reload();
    void run_script(const wxString& javascript);

private:
    void on_error(wxWebViewEvent& evt);
    void on_navigating(wxWebViewEvent& evt);
    void on_new_window(wxWebViewEvent& evt);
    void on_script_message(wxWebViewEvent& evt);
    void show_not_running(bool starting);

    std::string m_view;
    wxWebView*  m_browser{nullptr};
    bool        m_loaded{false};
};

} // namespace GUI
} // namespace Slic3r

#endif
