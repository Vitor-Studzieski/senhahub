function sanitizeDisplayState(state = {}) {
  return {
    ...state,
    sectors: Array.isArray(state.sectors)
      ? state.sectors.map((sector) => {
        const { currentCustomerName, tickets, recentCalls, ...publicSector } = sector || {};
        const sanitized = { ...publicSector };
        if (Array.isArray(tickets)) {
          sanitized.tickets = tickets.map(({ customerName, customerId, currentCustomerName: ticketCustomerName, ...ticket }) => ticket);
        }
        if (Array.isArray(recentCalls)) {
          sanitized.recentCalls = recentCalls.map(({ customerName, customerId, ...call }) => call);
        }
        return sanitized;
      })
      : []
  };
}

module.exports = { sanitizeDisplayState };
