/* Profile Unhider site — demo widget loop + small enhancements */
(function () {
  "use strict";

  /* ── Support form → Trello board (via FormSubmit) ── */
  // Replace with your Trello board's email-to-board address
  // (board menu → ... → More → Email-to-board settings).
  // Note: this address is visible in the page source; anyone with it can
  // create cards. Trello lets you regenerate it if it's ever abused.
  var TRELLO_BOARD_EMAIL = "srijanreddy1+we7aar9nsa7qkrx2h6kq@boards.trello.com";

  var supportModal = document.getElementById("support-modal");
  if (supportModal) {
    var supportOpenBtn = document.getElementById("support-open");
    var supportCloseBtn = document.getElementById("support-close");
    var supportForm = document.getElementById("support-form");
    var supportError = document.getElementById("support-error");
    var supportSubmit = document.getElementById("support-submit");

    var SUPPORT_COOLDOWN_MS = 5 * 60 * 1000; // one message per 5 minutes per browser
    var SUPPORT_LAST_SENT_KEY = "rpu-support-last-sent";

    function cooldownRemainingMs() {
      var last = parseInt(localStorage.getItem(SUPPORT_LAST_SENT_KEY) || "0", 10);
      var elapsed = Date.now() - last;
      return elapsed < SUPPORT_COOLDOWN_MS ? SUPPORT_COOLDOWN_MS - elapsed : 0;
    }

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
