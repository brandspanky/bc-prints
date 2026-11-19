// What the customer pays for shipping, per order.
// WHCC economy dropship quoted $9.95 (+$0.50 delivery surcharge) for every
// size and material, so shipping is free to the buyer and absorbed in price.
// To charge instead, set PER_ORDER_CENTS (e.g. 1500 for $15).
const PER_ORDER_CENTS = 0;

export function shippingFor(items) {
  return PER_ORDER_CENTS
    ? { label: "Shipping", cents: PER_ORDER_CENTS }
    : { label: "Free shipping", cents: 0 };
}
