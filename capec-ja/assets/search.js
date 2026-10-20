// Pagefind を使った全文検索(サーバー不要)。
// 日本語の活用形(例:「騙して」)は見つからないことがあるため、0件のときは
// 漢字・カタカナ・英数字の部分だけで検索し直す(例:「騙して」→「騙」)。
(function () {
  "use strict";
  var root = document.body.getAttribute("data-root") || "../";
  var form = document.querySelector("[data-search-form]");
  var input = document.getElementById("q");
  var status = document.querySelector("[data-search-status]");
  var list = document.querySelector("[data-search-results]");
  var pf = null;

  function load() {
    if (!pf) pf = import(root + "pagefind/pagefind.js");
    return pf;
  }
  function fallbackQuery(q) {
    var parts = q.match(/[一-鿿々゠-ヿー]+|[A-Za-z0-9]+/g);
    return parts ? parts.join(" ") : "";
  }
  // 抜粋は文字と <mark> だけを取り出して組み立てる(それ以外の要素は捨てる)
  function appendExcerpt(el, html) {
    var doc = new DOMParser().parseFromString("<p>" + (html || "") + "</p>", "text/html");
    Array.prototype.forEach.call(doc.body.firstChild.childNodes, function (n) {
      if (n.nodeType === 3) el.appendChild(document.createTextNode(n.nodeValue));
      else if (n.nodeName === "MARK") {
        var m = document.createElement("mark");
        m.textContent = n.textContent;
        el.appendChild(m);
      } else el.appendChild(document.createTextNode(n.textContent || ""));
    });
  }
  function show(results, q, note) {
    list.innerHTML = "";
    results.forEach(function (d) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = d.url;
      a.textContent = (d.meta && d.meta.title) || d.url;
      var p = document.createElement("p");
      p.className = "small";
      appendExcerpt(p, d.excerpt);
      li.appendChild(a);
      li.appendChild(p);
      list.appendChild(li);
    });
    status.textContent = "「" + q + "」の検索結果：" + results.length + "件" + (note || "");
  }
  function run(q) {
    q = (q || "").trim();
    if (!q) { status.textContent = ""; list.innerHTML = ""; return; }
    status.textContent = "検索しています…";
    load().then(function (pagefind) {
      return pagefind.search(q).then(function (res) {
        if (res.results.length) return { res: res, note: "" };
        var fq = fallbackQuery(q);
        if (!fq || fq === q) return { res: res, note: "" };
        return pagefind.search(fq).then(function (r2) {
          return { res: r2, note: "（見つからなかったため「" + fq + "」で検索し直しました）" };
        });
      }).then(function (o) {
        return Promise.all(o.res.results.slice(0, 50).map(function (r) { return r.data(); })).then(function (ds) { show(ds, q, o.note); });
      });
    }).catch(function () {
      status.textContent = "検索の準備ができませんでした。トップページの一覧から探してください。";
    });
  }
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var q = input.value;
    try { history.replaceState(null, "", "?q=" + encodeURIComponent(q)); } catch (e) { /* 何もしない */ }
    run(q);
  });
  var initial = new URLSearchParams(location.search).get("q");
  if (initial) { input.value = initial; run(initial); }
})();
