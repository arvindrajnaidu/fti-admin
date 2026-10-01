/**
 * Fraud User Configuration
 *
 * This file maintains a list of known fraudulent user emails that should be
 * excluded from all analytics, metrics, and reporting.
 */

const FRAUD_USER_EMAILS = [
  'georgehopkins19787@gmail.com',
  'ravi1337kaji@gmail.com',
  'srikant.nayak1337@gmail.com',
  'codtechitsolutions1@gmail.com', // Neela Akhil Kumar — blocked Dec 2025
];

/**
 * Check if a user email is valid (not fraudulent)
 * @param {string} email - User email to check
 * @returns {boolean} - True if valid, false if fraudulent
 */
const isValidUser = (email) => {
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();
  return !FRAUD_USER_EMAILS.includes(normalizedEmail);
};

/**
 * Filter out orders from fraudulent users
 * @param {Array} orders - Array of order objects with senderEmail or email field
 * @returns {Array} - Filtered orders excluding fraud users
 */
const filterFraudOrders = (orders) => {
  return orders.filter(order => {
    const email = (order.senderEmail || order.email || '').toLowerCase().trim();
    return isValidUser(email);
  });
};

/**
 * Filter out fraudulent customers
 * @param {Array} customers - Array of customer objects with email field
 * @returns {Array} - Filtered customers excluding fraud users
 */
const filterFraudCustomers = (customers) => {
  return customers.filter(customer => {
    const email = (customer.email || '').toLowerCase().trim();
    return isValidUser(email);
  });
};

/**
 * Get count of excluded fraud users
 * @returns {number} - Number of fraud users configured
 */
const getFraudUserCount = () => FRAUD_USER_EMAILS.length;

module.exports = {
  FRAUD_USER_EMAILS,
  isValidUser,
  filterFraudOrders,
  filterFraudCustomers,
  getFraudUserCount
};
