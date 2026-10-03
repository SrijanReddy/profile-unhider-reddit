/* Profile Unhider site — demo widget loop + small enhancements */
(function () {
  "use strict";

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
