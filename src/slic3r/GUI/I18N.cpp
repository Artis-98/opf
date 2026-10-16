#include "I18N.hpp"
#include <wx/string.h>
#include <string>
#include <wx/translation.h>
#include <wx/strconv.h>

namespace Slic3r { namespace GUI {

namespace I18N {

// OPF: "OrcaSlicer" and "Orca Slicer" as words become "OPF". Not in the credits (a text that also names
// the projects OPF comes from, or OPF itself), not in links, and not in file or folder names such as
// OrcaSlicer.conf or a path.
wxString branded(const wxString &s)
{
    if (s.Find(wxString("Orca")) == wxNOT_FOUND)
        return s;
    for (const char *keep : {"OPF", "PrusaSlicer", "Slic3r", "BambuStudio", "Bambu Studio", "SuperSlicer", "://", "www."})
        if (s.Find(wxString(keep)) != wxNOT_FOUND)
            return s;
    // Letters and digits (ASCII: next to Chinese or Japanese text the name is still a word of its own),
    // and the characters of file names and paths.
    auto part_of_name = [](wxUniChar c) {
        const auto v = c.GetValue();
        return (v >= '0' && v <= '9') || (v >= 'A' && v <= 'Z') || (v >= 'a' && v <= 'z') || v == '_' || v == '.' || v == '/' || v == '\\' || v == '-';
    };
    auto space = [](wxUniChar c) {
        const auto v = c.GetValue();
        return v == ' ' || v == '\n' || v == '\r' || v == '\t';
    };
    wxString        out = s;
    const wxString &o   = out; // reads give wxUniChar
    for (const wxString &name : {wxString("OrcaSlicer"), wxString("Orca Slicer")}) {
        size_t at = 0;
        while ((at = out.find(name, at)) != wxString::npos) {
            const size_t end = at + name.length();
            // A full stop after it ends a sentence ("... in OrcaSlicer."), unless a file name goes on.
            const bool   own_word = (at == 0 || !part_of_name(o[at - 1])) &&
                                  (end >= o.length() || !part_of_name(o[end]) ||
                                   (o[end].GetValue() == '.' && (end + 1 >= o.length() || space(o[end + 1]))));
            if (own_word) {
                out.replace(at, name.length(), "OPF");
                at += 3;
            } else
                at = end;
        }
    }
    return out;
}

} // namespace I18N

wxString L_str(const std::string &str)
{
	//! Explicitly specify that the source string is already in UTF-8 encoding
	return I18N::branded(wxGetTranslation(wxString(str.c_str(), wxConvUTF8)));
}

} }
