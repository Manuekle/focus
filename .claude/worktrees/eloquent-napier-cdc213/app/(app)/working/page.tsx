// The team conversation, full screen.
//
// Laid out the way /calendar is: no page padding, no floating card — the
// feed's own surfaces are divided by hairlines and reach every edge under the
// shell. The config — mode, participants, daily limit — opens in a drawer
// from the feed (working-screen.tsx). Same TeamFeed the /dev fixture looks at,
// wired to the real /api/team data.

import "../product.css";
import { WorkingScreen } from "./working-screen";

export default function WorkingPage() {
  return (
    <div className="content-enter flex h-full min-h-0 w-full flex-col overflow-hidden">
      <WorkingScreen />
    </div>
  );
}



