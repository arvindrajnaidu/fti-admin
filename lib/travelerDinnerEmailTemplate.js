// Pure HTML builder for the traveler dinner-recommendation email (admin app).
//
// On-brand shell: cream #faf1e5 page, white card with the 4px green top bar,
// Sanchez headings, Inter body, green #117150 pill CTAs, standard footer -
// matching the rest of our lifecycle email family.
//
// Privacy: no stay/hotel name, no address, no "near you" phrasing. Coordinates
// are used silently to choose restaurants and to seed the deep links. No re-pitch
// of the proposition; these are existing customers.
const { buildRestaurantSearchUrl } = require('./travelerDinnerRestaurants');

const SUBJECT = "What's for dinner tonight?";
const GREEN = '#117150';
const CREAM = '#faf1e5';
const INK = '#111827';
const MUTED = '#667085';
const LINE = '#EBE3DE';
const INTER = "'Inter',Arial,Helvetica,sans-serif";
const SANCHEZ = "'Sanchez','Georgia',serif";

const sanitize = (str) => (str ? String(str).replace(/[\r\n]+/g, ' ').trim() : '');
const esc = (str) => sanitize(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Long Swiggy names ("Radhe Dhokla-(Punjabi, Chinese, Thali & Biryani)") wrap
// to three lines and break card rhythm - clamp for display, links stay intact.
const clampName = (str, max = 40) => {
  const s = sanitize(str);
  return s.length > max ? `${s.slice(0, max - 3).trim()}...` : s;
};

const capitalizeFirstName = (value) => {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const firstNameFromSender = (senderName) => {
  const first = (senderName || '').trim().split(/\s+/)[0] || '';
  // A lone initial ("H.") reads as nonsense in a greeting.
  if (!first || /^[A-Za-z]\.?$/.test(first)) return 'there';
  return capitalizeFirstName(first);
};

// The whole card is clickable, not just "Order now" - users click the photo or
// the name just as often. Email clients (Outlook) can't wrap a table in one
// anchor, so each piece links to the same menu URL instead.
const renderCard = (card) => `
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:8px;overflow:hidden;">
                          <tr><td style="padding:0;background:#f3ede4;">
                            <a href="${esc(card.orderUrl)}" target="_blank" style="display:block;text-decoration:none;">
                              <img src="${esc(card.imageUrl)}" alt="${esc(clampName(card.name))}" width="100%" style="display:block;width:100%;height:120px;object-fit:cover;border:0;color:${MUTED};font-family:${INTER};font-size:12px;">
                            </a>
                          </td></tr>
                          <tr><td style="padding:12px 14px 14px;">
                            <a href="${esc(card.orderUrl)}" target="_blank" style="display:block;text-decoration:none;color:inherit;">
                              <p style="font-family:${INTER};font-size:15px;font-weight:700;margin:0 0 3px;color:${INK};">${esc(clampName(card.name))}</p>
                              <p style="font-family:${INTER};color:${MUTED};font-size:12px;margin:0 0 10px;">${[card.cuisineLabel, card.ratingLabel].filter(Boolean).map(esc).join(' - ')}</p>
                            </a>
                            <a href="${esc(card.orderUrl)}" target="_blank" style="font-family:${INTER};color:${GREEN};font-size:13px;font-weight:700;text-decoration:none;">${esc(card.linkLabel)} &rarr;</a>
                          </td></tr>
                        </table>`;

// Cards two-per-row; .card-cell stacks them on mobile.
const renderCardGrid = (cards) => {
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) {
    const left = cards[i];
    const right = cards[i + 1];
    rows.push(`
                    <tr>
                      <td class="card-cell" width="50%" valign="top" style="padding:0 8px 16px 0;">${renderCard(left)}</td>
                      <td class="card-cell" width="50%" valign="top" style="padding:0 0 16px 8px;">${right ? renderCard(right) : ''}</td>
                    </tr>`);
  }
  return rows.join('');
};

// "Order again": the customer's own repeat restaurants near this location.
// Crisp and factual - the count is the whole pitch.
const timesLabel = (n) => (n === 2 ? 'twice' : `${n} times`);
const renderReorderRows = (rows) => rows.map((row, i) => `
                    <tr>
                      <td style="padding:10px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">
                        <a href="${esc(row.orderUrl)}" target="_blank" style="text-decoration:none;">
                          <span style="font-family:${INTER};font-size:14px;font-weight:600;color:${INK};">${esc(clampName(row.name))}</span>
                          <span style="font-family:${INTER};font-size:13px;color:${MUTED};"> - you've ordered here ${timesLabel(row.count)}</span>
                        </a>
                      </td>
                    </tr>`).join('');

const renderAlsoRows = (rows) => rows.map((row, i) => `
                    <tr>
                      <td style="padding:10px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">
                        <a href="${esc(row.orderUrl)}" target="_blank" style="text-decoration:none;">
                          <span style="font-family:${INTER};font-size:14px;font-weight:600;color:${INK};">${esc(clampName(row.name))}</span>
                          <span style="font-family:${INTER};font-size:13px;color:${MUTED};">${row.cuisineLabel ? ` - ${esc(row.cuisineLabel)}` : ''}</span>
                        </a>
                      </td>
                    </tr>`).join('');

/**
 * @param {object} args
 * @param {string} [args.senderName]
 * @param {string} args.senderEmail
 * @param {number|string} args.lat
 * @param {number|string} args.lng
 * @param {object[]} [args.cards]
 * @param {object[]} [args.alsoDelivering]
 */
function buildTravelerDinnerEmailHtml({ senderName, senderEmail, lat, lng, area, cards = [], alsoDelivering = [], reorderRows = [], linkOrigin }) {
  const firstName = firstNameFromSender(senderName);
  const unsubscribeUrl = `https://www.foodtoindia.com/unsubscribe?email=${encodeURIComponent(senderEmail || '')}`;
  const browseUrl = buildRestaurantSearchUrl({ lat, lng, area, origin: linkOrigin });
  const logoUrl = 'https://foodtoindia.com?utm_source=email&utm_medium=lifecycle&utm_campaign=traveler_dinner&utm_content=logo';

  // Count is dynamic: a location may yield fewer than 4 cards, and the preheader
  // must not promise more than the email shows.
  const count = cards.length;
  const preheader = `${count} restaurant${count === 1 ? '' : 's'} delivering to you right now.`;

  const reorderSection = reorderRows.length > 0 ? `
              <tr>
                <td style="padding:8px 28px 6px 28px;">
                  <p style="margin:0;font-family:${INTER};font-size:13px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Order again</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${renderReorderRows(reorderRows)}
                  </table>
                </td>
              </tr>

              <tr><td style="height:12px;"></td></tr>` : '';

  const alsoSection = alsoDelivering.length > 0 ? `
              <tr>
                <td style="padding:8px 28px 6px 28px;">
                  <p style="margin:0;font-family:${INTER};font-size:13px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">A few more</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${renderAlsoRows(alsoDelivering)}
                  </table>
                </td>
              </tr>

              <tr><td style="height:12px;"></td></tr>

              <tr>
                <td style="padding:0 28px 8px 28px;">
                  <a href="${esc(browseUrl)}" target="_blank" style="font-family:${INTER};font-size:13px;font-weight:700;color:${GREEN};text-decoration:none;">See all restaurants &rarr;</a>
                </td>
              </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sanchez:ital@0;1&family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
    a { text-decoration: none; }
    @media screen and (max-width: 620px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .px { padding-left: 20px !important; padding-right: 20px !important; }
      .card-cell { display: block !important; width: 100% !important; padding: 0 0 16px 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${INTER};color:${INK};">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}${'&#847; '.repeat(40)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
    <tr><td align="center" style="padding:0;">
      <table class="container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <tr><td style="height:32px;"></td></tr>

        <tr>
          <td class="px" align="left" style="padding:0 28px 28px 28px;">
            <a href="${logoUrl}" target="_blank" style="text-decoration:none !important;color:${GREEN};">
              <span style="font-family:${SANCHEZ};font-size:22px;font-weight:400;color:${GREEN};letter-spacing:-0.3px;text-decoration:none;">foodtoIndia</span>
            </a>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">

              <tr><td style="height:4px;background:${GREEN};"></td></tr>

              <tr>
                <td style="padding:32px 28px 8px 28px;">
                  <h1 style="margin:0;font-family:${SANCHEZ};font-size:36px;font-weight:400;line-height:1.15;color:${INK};">Tonight's Dinner Options</h1>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 6px 28px;">
                  <p style="margin:0;font-family:${INTER};font-size:15px;line-height:1.6;color:${INK};">${esc(firstName)}, take your pick.</p>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 22px 28px;">
                  <p style="margin:0;font-family:${INTER};font-size:13px;line-height:1.5;color:${MUTED};">Order before 10pm IST.</p>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 28px 28px;">
                  <a href="${esc(browseUrl)}" target="_blank" style="display:inline-block;background:${GREEN};border-radius:999px;color:#ffffff;font-family:${INTER};font-weight:700;font-size:15px;padding:13px 26px;text-decoration:none;">Browse restaurants</a>
                </td>
              </tr>

              <tr><td style="padding:0 28px;"><div style="height:1px;background:${LINE};"></div></td></tr>

              <tr>
                <td style="padding:24px 28px 16px 28px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td align="left" style="font-family:${INTER};font-size:18px;font-weight:700;color:${INK};">Popular for dinner tonight</td>
                    <td align="right"><a href="${esc(browseUrl)}" target="_blank" style="font-family:${INTER};color:${GREEN};font-size:13px;font-weight:700;text-decoration:none;">See all</a></td>
                  </tr></table>
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${renderCardGrid(cards)}
                  </table>
                </td>
              </tr>
${reorderSection}${alsoSection}
              <tr><td style="padding:8px 28px 0;"><div style="height:1px;background:${LINE};"></div></td></tr>

              <tr>
                <td style="padding:24px 28px 28px 28px;">
                  <p style="margin:0 0 6px 0;font-family:${SANCHEZ};font-size:20px;font-weight:400;color:${INK};">Tomorrow sorted too.</p>
                  <p style="margin:0 0 16px 0;font-family:${INTER};font-size:14px;color:${MUTED};line-height:1.5;">Schedule delivery in advance at checkout.</p>
                  <a href="${esc(browseUrl)}" target="_blank" style="display:inline-block;background:${GREEN};border-radius:999px;color:#ffffff;font-family:${INTER};font-weight:700;font-size:14px;padding:12px 24px;text-decoration:none;">Schedule tomorrow's meal</a>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <tr>
          <td class="px" align="center" style="padding:20px 28px 6px 28px;">
            <p style="margin:0;font-family:${INTER};font-size:12px;color:${MUTED};">
              Follow us on Instagram: <a href="https://instagram.com/food2india" target="_blank" style="color:${GREEN};text-decoration:none;">@food2india</a>
            </p>
          </td>
        </tr>
        <tr>
          <td class="px" align="center" style="padding:0 28px 6px 28px;">
            <p style="margin:0;font-family:${INTER};font-size:12px;color:${MUTED};">
              <a href="https://foodtoindia.com" target="_blank" style="color:${MUTED};text-decoration:none;">foodtoindia.com</a>
            </p>
          </td>
        </tr>
        <tr>
          <td class="px" align="center" style="padding:0 28px 28px 28px;">
            <p style="margin:0;font-family:${INTER};font-size:11px;color:#999;">
              <a href="${esc(unsubscribeUrl)}" target="_blank" style="color:#999;text-decoration:underline;">Unsubscribe</a>
            </p>
          </td>
        </tr>

        <tr><td style="height:16px;"></td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

module.exports = { buildTravelerDinnerEmailHtml, firstNameFromSender, SUBJECT };
