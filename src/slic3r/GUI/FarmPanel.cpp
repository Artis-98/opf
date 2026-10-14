#include "FarmPanel.hpp"

#include <string>
#include <utility>

#include <boost/log/trivial.hpp>
#include <wx/sizer.h>
#include <wx/utils.h>
#include <wx/webview.h>

#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "OpfFarm.hpp"
#include "format.hpp"
#include "Widgets/WebView.hpp"

namespace Slic3r {
namespace GUI {

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

FarmPanel::FarmPanel(wxWindow* parent, std::string view)
    : wxPanel(parent, wxID_ANY, wxDefaultPosition, wxDefaultSize), m_view(std::move(view))
{
    auto* sizer = new wxBoxSizer(wxVERTICAL);
    m_browser   = WebView::CreateWebView(this, "");
    m_browser->Bind(wxEVT_WEBVIEW_ERROR, &FarmPanel::on_error, this);
    m_browser->Bind(wxEVT_WEBVIEW_NAVIGATING, &FarmPanel::on_navigating, this);
    m_browser->Bind(wxEVT_WEBVIEW_NEWWINDOW, &FarmPanel::on_new_window, this);
    m_browser->Bind(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, &FarmPanel::on_script_message, this);
    sizer->Add(m_browser, wxSizerFlags().Expand().Proportion(1));
    SetSizer(sizer);
    if (m_view == "farm")
        OpfFarm::get().record_slicer();
}

FarmPanel::~FarmPanel()
{
    SetEvtHandlerEnabled(false);
    if (m_browser) {
        m_browser->Destroy();
        m_browser = nullptr;
    }
}

bool FarmPanel::Show(bool show)
{
    // Load on first show: the farm page keeps itself up to date after that.
    if (show && !m_loaded) {
        m_loaded = true;
        WebView::LoadUrl(m_browser, OpfFarm::page_url(m_view));
    }
    return wxPanel::Show(show);
}

void FarmPanel::reload()
{
    WebView::LoadUrl(m_browser, OpfFarm::page_url(m_view));
}

void FarmPanel::run_script(const wxString& javascript)
{
    WebView::RunScript(m_browser, javascript);
}

void FarmPanel::on_error(wxWebViewEvent& evt)
{
    if (evt.GetInt() == wxWEBVIEW_NAV_ERR_USER_CANCELLED)
        return;
    BOOST_LOG_TRIVIAL(info) << "Farm tab: could not load " << into_u8(evt.GetURL()) << ": " << into_u8(evt.GetString());
    // Start OPF when it is set up on this computer, then keep trying until it answers.
    const bool starting = OpfFarm::get().start_service();
    // Not from inside the browser's own event: replace the page once it has finished reporting.
    CallAfter([this, starting] { show_not_running(starting); });
}

// The tab stays on the farm page: other addresses open in the default browser.
void FarmPanel::on_navigating(wxWebViewEvent& evt)
{
    const wxString url = evt.GetURL();
    if ((url.StartsWith("http://") || url.StartsWith("https://")) && !url.StartsWith(OpfFarm::farm_url())) {
        evt.Veto();
        wxLaunchDefaultBrowser(url);
    }
}

void FarmPanel::on_script_message(wxWebViewEvent& evt)
{
    // Only the farm page talks to the slicer.
    if (m_browser->GetCurrentURL().StartsWith(OpfFarm::farm_url()))
        OpfFarm::get().on_page_message(evt.GetString());
}

void FarmPanel::on_new_window(wxWebViewEvent& evt)
{
    const wxString url = evt.GetURL();
    if (!url.empty())
        wxLaunchDefaultBrowser(url);
    evt.Veto();
}

// Shown while the OPF farm service is not answering. It retries on its own, so the farm appears as
// soon as OPF is up.
void FarmPanel::show_not_running(bool starting)
{
    const bool     dark  = wxGetApp().dark_mode();
    const wxString url   = OpfFarm::page_url(m_view);
    const wxString title = html_escape(starting ? _L("Starting OPF...") : _L("OPF is not running"));
    const wxString body  = html_escape(starting ? _L("OPF checks for a new version and starts. Your printers appear here in a moment.") :
                                                  _L("This tab could not find OPF on this computer to start it. Open OPF once from its desktop "
                                                     "icon; after that this tab starts it by itself."));
    const wxString retry = html_escape(_L("Try again"));
    // TRN: %1% is a web address such as http://127.0.0.1:7878/
    const wxString where = html_escape(format_wxstr(_L("Looking for OPF at %1%"), OpfFarm::farm_url()));

    const wxString html = wxString::Format(
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "body{margin:0;height:100vh;display:grid;place-items:center;font-family:'Segoe UI',system-ui,sans-serif;"
        "background:%s;color:%s}"
        "main{max-width:460px;text-align:center;padding:24px}h1{font-size:20px;margin:0 0 10px}"
        "p{line-height:1.5;margin:0 0 16px;color:%s}small{color:%s}"
        "a{display:inline-block;padding:8px 16px;border-radius:7px;background:#00AE42;color:#fff;text-decoration:none;font-weight:600}"
        "</style></head><body><main><h1>%s</h1><p>%s</p><p><a href='%s'>%s</a></p><small>%s</small></main>"
        "<script>setTimeout(function(){location.href='%s';},%d);</script></body></html>",
        dark ? "#2d2d31" : "#ffffff", dark ? "#efeff0" : "#262e30", dark ? "#b8b8bc" : "#5c6466", dark ? "#8a8a8f" : "#8a9194",
        title, body, html_escape(url), retry, where, html_escape(url), starting ? 3000 : 5000);
    m_browser->SetPage(html, "");
}

} // namespace GUI
} // namespace Slic3r
