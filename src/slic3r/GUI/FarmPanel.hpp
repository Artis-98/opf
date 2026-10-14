#ifndef slic3r_FarmPanel_hpp_
#define slic3r_FarmPanel_hpp_

#include <wx/panel.h>
#include <wx/string.h>

#include "Lazy.hpp"

class wxWebView;
class wxWebViewEvent;

namespace Slic3r {
namespace GUI {

// OPF: the Farm tab. Shows the OPF farm service running on this computer (the printers on their
// shelves, each printer's queue, the timeline) as a web page. The service is a separate program
// (https://github.com/Artis-98/opf); while it is not running the tab says so and keeps retrying.
// The address can be changed with the "opf_farm_url" app config key.
class FarmPanel : public wxPanel, public LazyInstance<FarmPanel>
{
public:
    explicit FarmPanel(wxWindow* parent);
    ~FarmPanel() override;

    bool Show(bool show = true) override;
    void reload();

    static wxString farm_url();

private:
    void on_error(wxWebViewEvent& evt);
    void on_new_window(wxWebViewEvent& evt);
    void show_not_running();

    wxWebView* m_browser{nullptr};
    bool       m_loaded{false};
};

} // namespace GUI
} // namespace Slic3r

#endif
