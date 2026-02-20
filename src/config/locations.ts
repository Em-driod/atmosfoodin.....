export interface Location {
    name: string;
    fee: number;
}

// Kitchen coordinates: Oke Ogba, opposite nepa office, afon road, Ilorin
export const KITCHEN_COORDINATES = {
    lat: 8.4239,
    lng: 4.6002
};

export const PRICING = {
    BASE_FEE: 400,
    BASE_KM: 2,
    RATE_PER_KM: 200
};

/**
 * Calculates delivery fee based on distance in KM.
 * ₦400 base (up to 2km), then ₦200 per extra KM.
 */
export const calculateFeeFromDistance = (distanceKm: number): number => {
    if (distanceKm <= PRICING.BASE_KM) return PRICING.BASE_FEE;
    return PRICING.BASE_FEE + Math.ceil(distanceKm - PRICING.BASE_KM) * PRICING.RATE_PER_KM;
};

