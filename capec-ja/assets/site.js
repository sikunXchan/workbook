// 番号での移動、一覧の絞り込み、お気に入り、戻る
(function () {
  "use strict";
  var root = document.body.getAttribute("data-root") || "./";

  // ---- 戻る(このブラウザの、1つ前の履歴に戻る。無ければ上の階層へ) ----
  // 新しいタブで直接開いた場合などは、historyの中身が空の最初の1件だけのことがあり、
  // history.length だけで判断すると「戻る」が空白ページへ飛んでしまう。そのため、
  // 他のページからリンクで来たことを示す document.referrer もあわせて確認する。
  Array.prototype.forEach.call(document.querySelectorAll("[data-back]"), function (btn) {
    var fallback = btn.closest(".crumbs-row").querySelector(".crumbs a[href]");
    btn.addEventListener("click", function () {
      if (document.referrer && history.length > 1) { history.back(); return; }
      location.href = fallback ? fallback.getAttribute("href") : root;
    });
  });
  var idsPromise = null;
  function loadIds() {
    if (!idsPromise) {
      idsPromise = fetch(root + "assets/ids.json").then(function (r) { return r.json(); });
    }
    return idsPromise;
  }

  // ---- 検索欄：番号だけ(例：66、CAPEC-66、全角の６６)なら、その項目へ直接移動する ----
  Array.prototype.forEach.call(document.querySelectorAll("[data-search]"), function (form) {
    form.addEventListener("submit", function (ev) {
      var input = form.querySelector("input");
      var msg = form.querySelector("[data-search-msg]");
      var v = (input.value || "").replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).trim();
      var m = v.match(/^(?:capec)?[-\s]*(\d+)$/i);
      if (!m) return; // 番号でなければ、通常の検索ページへ
      ev.preventDefault();
      var id = String(parseInt(m[1], 10));
      loadIds().then(function (ids) {
        if (ids[id]) { location.href = root + "capec/" + id + "/"; }
        else if (msg) { msg.textContent = "CAPEC-" + id + " はデータにありません"; input.focus(); }
      }).catch(function () { form.submit(); });
    });
  });

  // ---- トップページの絞り込み ----
  var filters = document.querySelector("[data-filters]");
  if (filters) {
    var rows = Array.prototype.slice.call(document.querySelectorAll("table.list tbody tr"));
    var count = document.querySelector("[data-filter-count]");
    var selects = Array.prototype.slice.call(filters.querySelectorAll("select"));
    var apply = function () {
      var shown = 0;
      rows.forEach(function (tr) {
        var ok = selects.every(function (s) {
          if (!s.value) return true;
          var val = tr.getAttribute("data-" + s.getAttribute("data-key")) || "";
          return s.hasAttribute("data-multi") ? val.split(" ").indexOf(s.value) >= 0 : val === s.value;
        });
        tr.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = shown + "件";
    };
    selects.forEach(function (s) { s.addEventListener("change", apply); });
    filters.addEventListener("submit", function (ev) { ev.preventDefault(); });
  }

  // ---- お気に入り(このブラウザの中だけに保存) ----
  var KEY = "capec-ja-favorites";
  function getFavs() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function setFavs(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  var favBtn = document.querySelector("[data-fav]");
  if (favBtn) {
    var fid = favBtn.getAttribute("data-fav");
    var render = function () {
      var on = getFavs().indexOf(fid) >= 0;
      favBtn.setAttribute("aria-pressed", on ? "true" : "false");
      favBtn.textContent = on ? "お気に入りに登録済み（押すと解除）" : "お気に入りに追加";
    };
    favBtn.addEventListener("click", function () {
      var list = getFavs();
      var i = list.indexOf(fid);
      if (i >= 0) list.splice(i, 1); else list.push(fid);
      if (!setFavs(list)) { favBtn.textContent = "このブラウザでは保存できません"; return; }
      render();
    });
    render();
  }
  var favList = document.querySelector("[data-fav-list]");
  if (favList) {
    var favs = getFavs();
    var empty = document.querySelector("[data-fav-empty]");
    if (!favs.length) { empty.hidden = false; }
    else {
      loadIds().then(function (ids) {
        favs.forEach(function (id) {
          if (!ids[id]) return;
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.href = root + "capec/" + id + "/";
          a.textContent = "CAPEC-" + id + " " + (ids[id][1] || ids[id][2]);
          li.appendChild(a);
          favList.appendChild(li);
        });
      });
    }
  }

  // ---- 既読マーク(このブラウザの中だけに保存。開いたページを自動で記録する) ----
  var READ_KEY = "capec-ja-read";
  function getRead() {
    try { var v = JSON.parse(localStorage.getItem(READ_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function setRead(list) {
    try { localStorage.setItem(READ_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  // ChromeなどはリンクのホバーやURL予測で、ページを開く前に裏側で先読み(プリレンダリング)
  // することがある。そのタイミングでこのスクリプトが走ると、実際には開いていないのに
  // 既読になってしまうため、先読み中は記録せず、本当に表示されてから記録する。
  function markThisPageRead() {
    var thisPageReadId = document.body.getAttribute("data-read-id");
    if (!thisPageReadId) return;
    var readList = getRead();
    if (readList.indexOf(thisPageReadId) < 0) {
      readList.push(thisPageReadId);
      setRead(readList);
    }
  }
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", markThisPageRead, { once: true });
  } else {
    markThisPageRead();
  }
  var readSet = getRead();
  if (readSet.length) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-read-tag]"), function (el) {
      if (readSet.indexOf(el.getAttribute("data-read-tag")) >= 0) { el.hidden = false; }
    });
  }
})();
