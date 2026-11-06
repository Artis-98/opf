/* Progressive enhancement: downloads still work without JavaScript or GitHub's API. */
(async () => {
  try {
    const r = await fetch(
      "https://api.github.com/repos/Artis-98/opf/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!r.ok) return;
    const release = await r.json();
    const installer = (release.assets || []).find((a) =>
      /^OPF_Setup_.*\.exe$/i.test(a.name),
    );
    const portable = (release.assets || []).find((a) =>
      /portable.*\.zip$/i.test(a.name),
    );
    const version = String(release.tag_name || "").replace(/^v/i, "");
    const setLink = (element, url) => {
      if (
        element &&
        typeof url === "string" &&
        url.startsWith("https://github.com/Artis-98/opf/")
      )
        element.href = url;
    };
    if (installer)
      document
        .querySelectorAll(".download-link")
        .forEach((a) => setLink(a, installer.browser_download_url));
    if (portable)
      setLink(
        document.getElementById("dl-portable"),
        portable.browser_download_url,
      );
    setLink(document.getElementById("dl-notes"), release.html_url);
    if (version)
      document.getElementById("dl-version").textContent =
        version +
        (installer ? " · " + Math.round(installer.size / 1048576) + " MB" : "");
  } catch {
    /* The release-page fallback remains usable. */
  }
})();
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const selected = t === tab;
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    }
  });
});
