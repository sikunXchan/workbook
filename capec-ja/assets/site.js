// IDで移動、一覧の絞り込み、お気に入り
(function () {
  "use strict";
  var root = document.body.getAttribute("data-root") || "./";
  var idsPromise = null;
  function loadIds() {
    if (!idsPromise) {
      idsPromise = fetch(root + "assets/ids.json").then(function (r) { return r.json(); });
    }
    return idsPromise;
  }

  // ---- IDで移動 ----
  var jump = document.querySelector("[data-idjump]");
  if (jump) {
    jump.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = jump.querySelector("input");
      var msg = jump.querySelector(".idjump-msg");
      // 全角数字や「CAPEC-」付きの入力も受け付ける
      var v = (input.value || "").replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
      var m = v.match(/\d+/);
      if (!m) { msg.textContent = "数字のIDを入力してください（例：66）"; input.focus(); return; }
      var id = String(parseInt(m[0], 10));
      loadIds().then(function (ids) {
        if (ids[id]) { location.href = root + "capec/" + id + "/"; }
        else { msg.textContent = "CAPEC-" + id + " はデータにありません"; input.focus(); }
      }).catch(function () { msg.textContent = "IDの一覧を読み込めませんでした"; });
    });
  }

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
      count.textContent = shown + "件を表示";
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
})();
