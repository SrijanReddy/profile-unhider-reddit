/* Profile Unhider site — demo widget loop + small enhancements */
(function () {
  "use strict";

  /* ── Support form → Trello board (via FormSubmit) ── */
  // Replace with your Trello board's email-to-board address
  // (board menu → ... → More → Email-to-board settings).
  // Note: this address is visible in the page source; anyone with it can
  // create cards. Trello lets you regenerate it if it's ever abused.
  var TRELLO_BOARD_EMAIL = "srijanreddy1+we7aar9nsa7qkrx2h6kq@boards.trello.com";

  /* Shared by the support form and the goodbye box: one message per
     5 minutes per browser, so the board can't be spammed from one tab. */
  var SUPPORT_COOLDOWN_MS = 5 * 60 * 1000;
  var SUPPORT_LAST_SENT_KEY = "rpu-support-last-sent";

  function cooldownRemainingMs() {
    var last = parseInt(localStorage.getItem(SUPPORT_LAST_SENT_KEY) || "0", 10);
    var elapsed = Date.now() - last;
    return elapsed < SUPPORT_COOLDOWN_MS ? SUPPORT_COOLDOWN_MS - elapsed : 0;
  }

  var supportModal = document.getElementById("support-modal");
  if (supportModal) {
    var supportOpenBtn = document.getElementById("support-open");
    var supportCloseBtn = document.getElementById("support-close");
    var supportForm = document.getElementById("support-form");
    var supportError = document.getElementById("support-error");
    var supportSubmit = document.getElementById("support-submit");

    function openSupport() {
      supportModal.classList.add("open");
      document.body.style.overflow = "hidden";
      var remaining = cooldownRemainingMs();
      if (remaining > 0) {
        var mins = Math.ceil(remaining / 60000);
        supportError.textContent = "You just sent a message — please wait " + mins + " minute" + (mins > 1 ? "s" : "") + " before sending another.";
        supportError.classList.add("show");
        supportSubmit.disabled = true;
      } else {
        supportError.classList.remove("show");
        supportSubmit.disabled = false;
      }
      var email = document.getElementById("support-email");
      if (email) email.focus();
    }
    function closeSupport() {
      supportModal.classList.remove("open");
      document.body.style.overflow = "";
      if (window.location.hash === "#support") {
        history.replaceState(null, "", window.location.pathname);
      }
    }

    if (supportOpenBtn) supportOpenBtn.addEventListener("click", openSupport);
    if (supportCloseBtn) supportCloseBtn.addEventListener("click", closeSupport);
    supportModal.addEventListener("click", function (e) {
      if (e.target === supportModal) closeSupport();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && supportModal.classList.contains("open")) closeSupport();
    });

    // Deep link: profile-unhider.vercel.app/#support opens the form (used by the extension popup)
    if (window.location.hash === "#support") openSupport();

    if (supportForm) {
      supportForm.addEventListener("submit", function (e) {
        e.preventDefault();
        supportError.classList.remove("show");
        var email = document.getElementById("support-email").value.trim();
        var message = document.getElementById("support-message").value.trim();
        var honey = document.getElementById("support-honey").value;
        if (honey) return; // bot
        var remaining = cooldownRemainingMs();
        if (remaining > 0) {
          var mins = Math.ceil(remaining / 60000);
          return fail("Please wait " + mins + " minute" + (mins > 1 ? "s" : "") + " before sending another message.");
        }
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return fail("Please enter a valid email address.");
        }
        if (message.length < 10) {
          return fail("Please describe the problem in a little more detail (10+ characters).");
        }
        if (message.length > 2000) {
          return fail("Please keep it under 2000 characters.");
        }
        supportSubmit.disabled = true;
        supportSubmit.textContent = "Sending…";
        fetch("https://formsubmit.co/ajax/" + encodeURIComponent(TRELLO_BOARD_EMAIL), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            email: email,
            message: message,
            _subject: "[Support] " + message.slice(0, 60),
            _template: "table"
          })
        }).then(function (res) {
          if (!res.ok) throw new Error("send failed");
          return res.json();
        }).then(function () {
          try { localStorage.setItem(SUPPORT_LAST_SENT_KEY, String(Date.now())); } catch (e) {}
          supportForm.innerHTML =
            '<p class="lede" style="margin-bottom:0">✓ Message sent — we\'ll get back to you at ' +
            email.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
            ".</p>";
        }).catch(function () {
          fail("Couldn't send right now — please try again in a bit.");
        }).finally(function () {
          supportSubmit.disabled = false;
          supportSubmit.textContent = "Send message";
        });

        function fail(msg) {
          supportError.textContent = msg;
          supportError.classList.add("show");
        }
      });
    }
  }

  /* ── Goodbye box → same Trello board (via FormSubmit) ──
     Leaving-only: opens only at #goodbye (the extension's uninstall URL).
     Same endpoint, same board email, same 5-minute cooldown and honeypot
     as the support form. Subject is tagged [Uninstall] so the cards can
     be told apart. Email is optional; "What's happening?" is required
     only when the reason is Other. */
  var goodbyeModal = document.getElementById("goodbye-modal");
  if (goodbyeModal) {
    var goodbyeCloseBtn = document.getElementById("goodbye-close");
    var goodbyeForm = document.getElementById("goodbye-form");
    var goodbyeError = document.getElementById("goodbye-error");
    var goodbyeSubmit = document.getElementById("goodbye-submit");
    var goodbyeReasons = document.getElementById("goodbye-reasons");
    var goodbyeMessage = document.getElementById("goodbye-message");
    var goodbyeMessageOptional = document.getElementById("goodbye-message-optional");
    var goodbyeReason = "";

    // Reinstall goes to the store for the visitor's browser (same pattern
    // as the rating nudge in extension/content.js).
    var goodbyeReinstall = document.getElementById("goodbye-reinstall");
    var reinstallHref = "https://chromewebstore.google.com/detail/profile-unhider/kgfaggmcfklfakaaoijpeldikdokgfmp";
    if (goodbyeReinstall && navigator.userAgent.indexOf("Firefox") !== -1) {
      reinstallHref = "https://addons.mozilla.org/firefox/addon/profile-unhider/";
      goodbyeReinstall.href = reinstallHref;
    }

    function goodbyeVersion() {
      // The uninstall URL carries ?v= after the hash (#goodbye?v=3.4.1),
      // so read it from the fragment first, then from the query string.
      var hash = window.location.hash || "";
      var q = hash.indexOf("?") !== -1 ? hash.slice(hash.indexOf("?") + 1) : "";
      try {
        var fromHash = new URLSearchParams(q).get("v");
        if (fromHash) return fromHash;
      } catch (e) {}
      try { return new URLSearchParams(window.location.search).get("v") || ""; } catch (e) { return ""; }
    }

    function openGoodbye() {
      goodbyeModal.classList.add("open");
      document.body.style.overflow = "hidden";
      var remaining = cooldownRemainingMs();
      if (remaining > 0) {
        var mins = Math.ceil(remaining / 60000);
        goodbyeError.textContent = "You just sent a message — please wait " + mins + " minute" + (mins > 1 ? "s" : "") + " before sending another.";
        goodbyeError.classList.add("show");
        goodbyeSubmit.disabled = true;
      } else {
        goodbyeError.classList.remove("show");
        goodbyeSubmit.disabled = false;
      }
    }
    function closeGoodbye() {
      goodbyeModal.classList.remove("open");
      document.body.style.overflow = "";
      if (window.location.hash.indexOf("#goodbye") === 0) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }

    if (goodbyeCloseBtn) goodbyeCloseBtn.addEventListener("click", closeGoodbye);
    goodbyeModal.addEventListener("click", function (e) {
      if (e.target === goodbyeModal) closeGoodbye();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && goodbyeModal.classList.contains("open")) closeGoodbye();
    });

    // Deep link: profile-unhider.vercel.app/#goodbye opens the box
    // (used by the extension's uninstall URL). Also accepts #goodbye?v=…
    if (window.location.hash.indexOf("#goodbye") === 0) openGoodbye();

    if (goodbyeReasons) {
      goodbyeReasons.addEventListener("click", function (e) {
        var chip = e.target.closest ? e.target.closest(".chip") : null;
        if (!chip || !goodbyeReasons.contains(chip)) return;
        var chips = goodbyeReasons.querySelectorAll(".chip");
        for (var i = 0; i < chips.length; i++) chips[i].classList.remove("on");
        chip.classList.add("on");
        goodbyeReason = chip.getAttribute("data-reason") || chip.textContent.trim();
        if (goodbyeMessageOptional) {
          goodbyeMessageOptional.textContent = goodbyeReason === "Other" ? "(required for Other)" : "(optional)";
        }
        goodbyeError.classList.remove("show");
      });
    }

    if (goodbyeForm) {
      goodbyeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        goodbyeError.classList.remove("show");
        var email = document.getElementById("goodbye-email").value.trim();
        var message = goodbyeMessage.value.trim();
        var honey = document.getElementById("goodbye-honey").value;
        if (honey) return; // bot
        var remaining = cooldownRemainingMs();
        if (remaining > 0) {
          var mins = Math.ceil(remaining / 60000);
          return fail("Please wait " + mins + " minute" + (mins > 1 ? "s" : "") + " before sending another message.");
        }
        if (!goodbyeReason) {
          return fail("Please pick a reason above.");
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return fail("Please enter a valid email address, or leave it blank.");
        }
        if (goodbyeReason === "Other" && message.length < 10) {
          return fail("Please tell us a little more about what happened (10+ characters).");
        }
        if (message.length > 2000) {
          return fail("Please keep it under 2000 characters.");
        }
        goodbyeSubmit.disabled = true;
        goodbyeSubmit.textContent = "Sending…";
        var version = goodbyeVersion();
        fetch("https://formsubmit.co/ajax/" + encodeURIComponent(TRELLO_BOARD_EMAIL), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            email: email || "not given",
            message: "Reason: " + goodbyeReason + (version ? "\nVersion: " + version : "") + "\n\n" + (message || "(no details given)"),
            _subject: "[Uninstall] " + goodbyeReason + (message ? " — " + message.slice(0, 60) : ""),
            _template: "table"
          })
        }).then(function (res) {
          if (!res.ok) throw new Error("send failed");
          return res.json();
        }).then(function () {
          try { localStorage.setItem(SUPPORT_LAST_SENT_KEY, String(Date.now())); } catch (err) {}
          goodbyeForm.innerHTML =
            '<p class="lede" style="margin-bottom:14px">✓ Thanks, got it. Your feedback goes straight to the support board.</p>' +
            '<a class="btn btn-reinstall" href="' + reinstallHref + '">Reinstall Profile Unhider</a>';
        }).catch(function () {
          fail("Couldn't send right now — please try again in a bit.");
        }).finally(function () {
          goodbyeSubmit.disabled = false;
          goodbyeSubmit.textContent = "Send feedback";
        });

        function fail(msg) {
          goodbyeError.textContent = msg;
          goodbyeError.classList.add("show");
        }
      });
    }
  }

  // Auto-looping reveal demo: hidden state <-> revealed state.
  var demo = document.getElementById("demo");
  if (demo) {
    var REVEAL_MS = 7000;
    var HIDE_MS = 6000;
    var timer = null;

    function showRevealed() {
      demo.classList.add("is-revealed");
      timer = window.setTimeout(showHidden, REVEAL_MS);
    }

    function showHidden() {
      demo.classList.remove("is-revealed");
      timer = window.setTimeout(showRevealed, HIDE_MS);
    }

    // Respect users who prefer reduced motion: show the revealed state statically.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      demo.classList.add("is-revealed");
    } else {
      // Start hidden, then begin the loop shortly after load.
      timer = window.setTimeout(showRevealed, 1200);
    }

    // Pause the loop while the tab is hidden so timers don't pile up.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && timer) {
        window.clearTimeout(timer);
        timer = null;
      } else if (!document.hidden && !timer && !demo.classList.contains("is-revealed")) {
        timer = window.setTimeout(showRevealed, 1500);
      }
    });
  }
})();
