#include "FarmPanel.hpp"

#include <string>

#include <boost/log/trivial.hpp>
#include <wx/sizer.h>
#include <wx/utils.h>
#include <wx/webview.h>

#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "format.hpp"
#include "libslic3r/AppConfig.hpp"
#include "Widgets/WebView.hpp"

namespace Slic3r {
namespace GUI {

static const char* DEFAULT_FARM_URL = "http://127.0.0.1:7878/";

static wxString html_escape(const wxString& s)
{
    wxString out;
    for (wxUniChar c : s) {
        switch (c.GetValue()) {
        case '&': out += "&amp;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '"': out += "&quot;"; break;
        default: out += c;
        }
    }
    return out;
}

FarmPanel::FarmPanel(wxWindow* parent) : wxPanel(parent, wxID_ANY, wxDefaultPosition, wxDefaultSize)
{
    auto* sizer = new wxBoxSizer(wxVERTICAL);
    m_browser   = WebView::CreateWebView(this, "");
    m_browser->Bind(wxEVT_WEBVIEW_ERROR, &FarmPanel::on_error, this);
    m_browser->Bind(wxEVT_WEBVIEW_NEWWINDOW, &FarmPanel::on_new_window, this);
    sizer->Add(m_browser, wxSizerFlags().Expand().Proportion(1));
    SetSizer(sizer);
}

FarmPanel::~FarmPanel()
{
    SetEvtHandlerEnabled(false);
    if (m_browser) {
        m_browser->Destroy();
        m_browser = nullptr;
    }
}

wxString FarmPanel::farm_url()
{
    const std::string url = wxGetApp().app_config->get("opf_farm_url");
    return from_u8(url.empty() ? std::string(DEFAULT_FARM_URL) : url);
}

bool FarmPanel::Show(bool show)
{
    // Load on first show: the farm page keeps itself up to date after that.
    if (show && !m_loaded) {
        m_loaded = true;
        WebView::LoadUrl(m_browser, farm_url());
    }
    return wxPanel::Show(show);
}

void FarmPanel::reload()
{
    WebView::LoadUrl(m_browser, farm_url());
}

void FarmPanel::on_error(wxWebViewEvent& evt)
{
    if (evt.GetInt() == wxWEBVIEW_NAV_ERR_USER_CANCELLED)
        return;
    BOOST_LOG_TRIVIAL(info) << "Farm tab: could not load " << into_u8(evt.GetURL()) << ": " << into_u8(evt.GetString());
    // Not from inside the browser's own event: replace the page once it has finished reporting.
    CallAfter([this] { show_not_running(); });
}

void FarmPanel::on_new_window(wxWebViewEvent& evt)
{
    const wxString url = evt.GetURL();
    if (!url.empty())
        wxLaunchDefaultBrowser(url);
    evt.Veto();
}

// Shown while the OPF farm service is not answering. It retries on its own, so the farm appears as
// soon as OPF is started.
void FarmPanel::show_not_running()
{
    const bool     dark  = wxGetApp().dark_mode();
    const wxString url   = farm_url();
    const wxString title = html_escape(_L("OPF is not running"));
    const wxString body  = html_escape(_L("The Farm tab shows your printers on their shelves, each printer's queue and the timeline from OPF. "
                                          "Start OPF from its desktop icon and the farm appears here."));
    const wxString retry = html_escape(_L("Try again"));
    // TRN: %1% is a web address such as http://127.0.0.1:7878/
    const wxString where = html_escape(format_wxstr(_L("Looking for OPF at %1%"), url));

    const wxString html = wxString::Format(
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "body{margin:0;height:100vh;display:grid;place-items:center;font-family:'Segoe UI',system-ui,sans-serif;"
        "background:%s;color:%s}"
        "main{max-width:460px;text-align:center;padding:24px}h1{font-size:20px;margin:0 0 10px}"
        "p{line-height:1.5;margin:0 0 16px;color:%s}small{color:%s}"
        "a{display:inline-block;padding:8px 16px;border-radius:7px;background:#009688;color:#fff;text-decoration:none;font-weight:600}"
        "</style></head><body><main><h1>%s</h1><p>%s</p><p><a href='%s'>%s</a></p><small>%s</small></main>"
        "<script>setTimeout(function(){location.href='%s';},5000);</script></body></html>",
        dark ? "#2d2d31" : "#ffffff", dark ? "#efeff0" : "#262e30", dark ? "#b8b8bc" : "#5c6466", dark ? "#8a8a8f" : "#8a9194",
        title, body, html_escape(url), retry, where, html_escape(url));
    m_browser->SetPage(html, "");
}

} // namespace GUI
} // namespace Slic3r
