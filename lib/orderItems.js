// pages/api/orders.js in the foodtoindia app appends "\nNotes: ..." to the
// last lineItem's name so the Slack [NEW ORDER] template renders notes after
// the items list. For admin display purposes (orders modal, email composer,
// cancel email, CSV export) we want only the original item name; everything
// after the first newline is the Slack-only suffix.
export const stripNotesSuffix = (name) => (name || '').split('\n')[0];
