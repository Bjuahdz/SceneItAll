import React from "react";
import { View } from "react-native";

/**
 * COMPOSE — the field has focus and nothing is typed yet.
 *
 * ▸ IT RENDERS NOTHING, ON PURPOSE. Bryan, 2026-08-02: "I think for us it's probably
 *   best that we just keep it blank, at least blank for now."
 *
 * ▸ WHY IT EXISTS AT ALL. Before this, tapping the field left the recents ledger on
 *   screen with every row collapsed. That was harmless when recents were a text list.
 *   It stops being harmless the moment recents become a wall of artwork (see the
 *   RECENT BOARD increments): you would be typing over your own history, with a
 *   picture behind every keystroke. The blank screen is not a stylistic choice — it
 *   is what the picture board forces.
 *
 * ▸ INITIAL STATE ONLY. The first keystroke leaves the idle phase, and the prefix
 *   typeahead that already ships takes over. Nothing here is on the path between
 *   "started typing" and "saw results".
 *
 * ▸ EMPTY TEXT DOES NOT BRING THE BOARD BACK. Backspacing to nothing returns you
 *   here, not to the board — otherwise the board would reappear behind the keyboard
 *   the instant you deleted the last character, which is exactly the picture wall
 *   this exists to avoid. Blank means one thing and one thing only: the field has
 *   focus. The board returns when the KEYBOARD goes down.
 *
 * A component rather than a bare `return null` because every sibling state is one
 * (EmptyState, ZeroResults, DefaultState, SubmittedState), and it names itself in
 * the render tree.
 *
 * ▸ COMPOSE DID EVENTUALLY EARN SOMETHING — QUICK SEARCHES (2026-08-08) — and it
 *   deliberately did NOT land here. The cards anchor above the ISLAND, which lives
 *   in screen space riding the keyboard, so they render in the screen layer
 *   (see QuickSearches in search.tsx). This body stays empty, and the anchor
 *   argument below is still the reason it must keep rendering a View.
 *
 * ⚠ AN EMPTY VIEW, NOT `null`, AND THAT IS LOAD-BEARING.
 *
 * The screen's ScrollView runs `maintainVisibleContentPosition={{ minIndexForVisible:
 * 0 }}`, which anchors on the ScrollView's DIRECT CHILDREN — and it only has two, the
 * state body and the nav clearance. Returning `null` deleted the body, promoting the
 * clearance to child 0; the instant a result list rendered, a screen-tall child was
 * INSERTED ABOVE that anchor, so the offset shifted down by the height of the
 * insertion to hold the anchor still. The typing list opened scrolled to about row
 * six (Bryan, device, 2026-08-02).
 *
 * A zero-height View keeps the child there. Its height goes 0 → N instead of the node
 * appearing from nowhere, and growing the anchor itself is not something
 * maintainVisibleContentPosition compensates for.
 */
export default function ComposeState() {
  return <View />;
}
