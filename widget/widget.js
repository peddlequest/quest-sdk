/*! PeddleQuest widget loader 0.2.0 | MIT | https://docs.peddlequest.xyz/docs/integrations/embed
 *
 * Zero-dependency loader for the PeddleQuest widgets. Add the script once and
 * mark any element (or the script tag itself) with a data attribute:
 *
 *   <script src="https://peddlequest.xyz/widget.js" data-peddlequest-quest="your-quest-link" async></script>
 *   <div data-peddlequest-leaderboard="your-quest-link" data-peddlequest-limit="10"></div>
 *   <div data-peddlequest-live-quests data-peddlequest-project="your-project"></div>
 *   <div data-peddlequest-live-quests data-peddlequest-chain="base"></div>
 *
 * Options (all optional): data-peddlequest-theme (dark|light), -limit, -ref,
 * -height, -max-width, -title, -auto-height="false".
 *
 * Each widget is an iframe of the app. Its height follows the
 * `peddlequest:resize` messages the widget posts, accepted only from that
 * iframe's own window and from the app's origin (the origin this script was
 * loaded from). `window.PeddleQuestWidgets.mount()` re-scans the page, for
 * content added after load. Read-only: nothing here reads the host page.
 */
(function () {
  "use strict";
  var w = window;
  var d = document;
  if (w.PeddleQuestWidgets && typeof w.PeddleQuestWidgets.mount === "function") {
    w.PeddleQuestWidgets.mount();
    return;
  }

  var APP = "https://peddlequest.xyz";
  var script = d.currentScript;
  try {
    if (script && script.src) APP = new URL(script.src, w.location.href).origin;
  } catch (e) {
    /* keep the default */
  }

  var MSG = "peddlequest:resize";
  var KINDS = { quest: 1, leaderboard: 1, "live-quests": 1 };
  var SELECTOR = "[data-peddlequest-quest],[data-peddlequest-leaderboard],[data-peddlequest-live-quests]";
  var BG = { dark: "#05080f", light: "#f3f6fb" };
  var frames = [];

  function attr(el, name) {
    var v = el.getAttribute("data-peddlequest-" + name);
    return v == null ? "" : String(v).trim();
  }

  function has(el, name) {
    return el.getAttribute("data-peddlequest-" + name) != null;
  }

  function query(params) {
    var out = [];
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k]) {
        out.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    }
    return out.length ? "?" + out.join("&") : "";
  }

  function spec(el) {
    var theme = attr(el, "theme") === "light" ? "light" : "dark";
    var limit = /^\d+$/.test(attr(el, "limit")) ? attr(el, "limit") : "";
    var ref = attr(el, "ref");
    var link;
    if ((link = attr(el, "quest"))) {
      return {
        theme: theme, height: 520, maxWidth: "360px", title: link + " on PeddleQuest",
        src: APP + "/iframe/" + encodeURIComponent(link) + query({ theme: theme, ref: ref })
      };
    }
    if ((link = attr(el, "leaderboard"))) {
      return {
        theme: theme, height: 480, maxWidth: "400px", title: link + " leaderboard on PeddleQuest",
        src: APP + "/widget/leaderboard/" + encodeURIComponent(link) + query({ theme: theme, limit: limit, ref: ref })
      };
    }
    if (has(el, "live-quests")) {
      var project = attr(el, "project");
      return {
        theme: theme, height: 420, maxWidth: "400px", title: "Live quests on PeddleQuest",
        src: APP + "/widget/quests" + query({
          project: project,
          chain: project ? "" : attr(el, "chain"),
          theme: theme, limit: limit, ref: ref
        })
      };
    }
    return null;
  }

  function mountOne(el) {
    if (has(el, "mounted")) return;
    var s = spec(el);
    if (!s) return;
    el.setAttribute("data-peddlequest-mounted", "");

    var height = /^\d+$/.test(attr(el, "height")) ? Number(attr(el, "height")) : s.height;
    var f = d.createElement("iframe");
    f.src = s.src;
    f.title = attr(el, "title") || s.title;
    f.setAttribute("loading", "lazy");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    var st = f.style;
    st.display = "block";
    st.width = "100%";
    st.maxWidth = attr(el, "max-width") || s.maxWidth;
    st.height = height + "px";
    st.border = "0";
    st.borderRadius = "12px";
    st.colorScheme = s.theme;
    st.background = BG[s.theme];

    if (el.tagName === "SCRIPT") {
      if (el.parentNode) el.parentNode.insertBefore(f, el.nextSibling);
    } else {
      el.appendChild(f);
    }
    frames.push({ iframe: f, auto: attr(el, "auto-height") !== "false" });
  }

  function mount(root) {
    var list = (root || d).querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) mountOne(list[i]);
  }

  w.addEventListener("message", function (e) {
    var m = e.data;
    if (e.origin !== APP || !m || m.type !== MSG || !KINDS[m.widget]) return;
    if (typeof m.height !== "number" || !isFinite(m.height) || m.height < 40 || m.height > 10000) return;
    for (var i = 0; i < frames.length; i++) {
      var fr = frames[i];
      if (fr.auto && fr.iframe.contentWindow && fr.iframe.contentWindow === e.source) {
        fr.iframe.style.height = Math.ceil(m.height) + "px";
        return;
      }
    }
  });

  w.PeddleQuestWidgets = { version: "0.2.0", mount: mount };

  mount();
  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", function () {
      mount();
    });
  }
})();
