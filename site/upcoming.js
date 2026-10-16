/* What is coming next in OPF, read live from the admin board
 * (api.iiteg.com/opf-upcoming.php) in three groups by how soon: urgent is the
 * next update, high comes soon after, normal is on the list for later. The
 * section stays hidden until the list arrives, so if the board cannot be
 * reached the page simply does not mention it. */
(function () {
  var holder = document.getElementById("upcoming-list");
  if (!holder) { return; }
  var LEVELS = [
    ["urgent", "Next update", "Being built now, for the next release."],
    ["high", "Soon", "Lined up for the releases after that."],
    ["normal", "Later", "On the list, not scheduled yet."]
  ];
  fetch("https://api.iiteg.com/opf-upcoming.php", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (data) {
      var items = (data && data.upcoming) || [];
      if (!items.length) { return; }
      LEVELS.forEach(function (level) {
        var mine = items.filter(function (item) { return (item.priority || "urgent") === level[0]; });
        if (!mine.length) { return; }
        var group = document.createElement("div");
        group.className = "upcoming-group level-" + level[0];
        var head = document.createElement("h3");
        head.className = "upcoming-head";
        head.textContent = level[1];
        var count = document.createElement("span");
        count.className = "count";
        count.textContent = mine.length;
        head.appendChild(count);
        var note = document.createElement("p");
        note.className = "upcoming-note";
        note.textContent = level[2];
        var list = document.createElement("ol");
        list.className = "upcoming-list";
        mine.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item.title;
          if (item.status === "in_progress" || item.status === "review") {
            var tag = document.createElement("span");
            tag.className = "doing";
            tag.textContent = "in progress";
            li.appendChild(tag);
          }
          list.appendChild(li);
        });
        group.appendChild(head);
        group.appendChild(note);
        group.appendChild(list);
        holder.appendChild(group);
      });
      var box = document.getElementById("upcoming");
      if (box) { box.hidden = false; }
    })
    .catch(function () { /* nothing shown is better than something wrong */ });
})();
