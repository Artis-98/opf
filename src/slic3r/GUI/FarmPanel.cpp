#include "FarmPanel.hpp"

#include <string>
#include <utility>

#include <boost/log/trivial.hpp>
#include <wx/activityindicator.h>
#include <wx/gdicmn.h>
#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/utils.h>
#include <wx/webview.h>

#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "OpfFarm.hpp"
#include "Widgets/WebView.hpp"

namespace Slic3r {
namespace GUI {

FarmPanel::FarmPanel(wxWindow* parent, std::string view)
    : wxPanel(parent, wxID_ANY, wxDefaultPosition, wxDefaultSize), m_view(std::move(view)), m_retry(this)
{
    auto* sizer = new wxBoxSizer(wxVERTICAL);
    m_browser   = WebView::CreateWebView(this, "");
    m_loading = new wxPanel(this);
    auto* loading_sizer = new wxBoxSizer(wxVERTICAL);
    auto* spinner = new wxActivityIndicator(m_loading, wxID_ANY, wxDefaultPosition, wxSize(64, 64));
    m_loading_text = new wxStaticText(m_loading, wxID_ANY, _L("Starting OPF..."));
    loading_sizer->AddStretchSpacer();
    loading_sizer->Add(spinner, 0, wxALIGN_CENTER | wxBOTTOM, 20);
    loading_sizer->Add(m_loading_text, 0, wxALIGN_CENTER | wxALL, 20);
    loading_sizer->AddStretchSpacer();
    m_loading->SetSizerAndFit(loading_sizer);
    spinner->Start();
    sizer->Add(m_loading, wxSizerFlags().Expand().Proportion(1));
    m_browser->Hide();
    m_browser->Bind(wxEVT_WEBVIEW_LOADED, &FarmPanel::on_loaded, this);
    Bind(wxEVT_TIMER, [this](wxTimerEvent&) {
        m_failed = false;
        WebView::LoadUrl(m_browser, OpfFarm::page_url(m_view));
    }, m_retry.GetId());
    m_browser->Bind(wxEVT_WEBVIEW_ERROR, &FarmPanel::on_error, this);
    m_browser->Bind(wxEVT_WEBVIEW_NAVIGATING, &FarmPanel::on_navigating, this);
    m_browser->Bind(wxEVT_WEBVIEW_NEWWINDOW, &FarmPanel::on_new_window, this);
    m_browser->Bind(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, &FarmPanel::on_script_message, this);
    sizer->Add(m_browser, wxSizerFlags().Expand().Proportion(1));
    SetSizerAndFit(sizer);
    if (m_view == "farm")
        OpfFarm::get().record_slicer();
}

FarmPanel::~FarmPanel()
{
    m_retry.Stop();
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
        show_not_running(true);
        WebView::LoadUrl(m_browser, OpfFarm::page_url(m_view));
    }
    return wxPanel::Show(show);
}

void FarmPanel::reload()
{
    m_retry.Stop();
    m_failed = false;
    show_not_running(true);
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
    m_failed = true;
    // Keep browser-generated connection errors hidden behind the native loading view.
    m_browser->Hide();
    m_loading->Show();
    Layout();
    // Start OPF when it is set up on this computer, then keep trying until it answers.
    const bool starting = OpfFarm::get().start_service();
    // Update the native loading view after the browser has finished reporting.
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

void FarmPanel::on_loaded(wxWebViewEvent& evt)
{
    if (m_failed || !evt.GetURL().StartsWith(OpfFarm::farm_url()))
        return;
    m_retry.Stop();
    m_loading->Hide();
    m_browser->Show();
    Layout();
}

// The browser loads and retries behind this view, so its connection-error page never flashes.
void FarmPanel::show_not_running(bool starting)
{
    m_browser->Hide();
    m_loading->Show();
    m_loading_text->SetLabel(starting ? _L("Starting OPF...") :
        _L("OPF could not start. Open OPF from its desktop icon. This page will reconnect automatically."));
    m_loading->Layout();
    Layout();
    if (m_failed)
        m_retry.StartOnce(3000);
}

} // namespace GUI
} // namespace Slic3r
