/**
 * Full wizard-shaped mock data for the 3 hostels already listed on the
 * Hostel Onboarding screen, keyed by the same Hostel ID shown in that table.
 * The list's own row only carries a handful of summary fields, so editing
 * needs this richer record to pre-fill all 7 steps of the wizard.
 */
export interface HostelWizardRecord {
  hostelInfo: {
    hostelName: string;
    hostelType: string;
    hostelCategory: string;
    gender: string;
    contactCountryCode: string;
    contactNumber: string;
    email: string;
    /** Defaults to +1 when omitted. */
    alternateCountryCode?: string;
    alternateContact: string;
    website: string;
    logoFileName: string;
  };
  address: {
    addressLine1: string;
    addressLine2: string;
    country: string;
    state: string;
    city: string;
    pincode: string;
    latitude: string;
    longitude: string;
  };
  capacity: {
    buildings: number;
    floors: number;
    rooms: number;
    totalBeds: number;
  };
  facilities: {
    wifi: boolean;
    mess: boolean;
    laundry: boolean;
    washingMachine: boolean;
    parking: boolean;
    housekeeping: boolean;
    security: boolean;
    cctv: boolean;
    gym: boolean;
    commonRoom: boolean;
    studyRoom: boolean;
    powerBackup: boolean;
    waterFacility: boolean;
    otherFacility: string;
  };
  admin: {
    firstName: string;
    lastName: string;
    mobileNumber: string;
    email: string;
    username: string;
    tempPassword: string;
    sendEmail: boolean;
    sendSms: boolean;
  };
  subscription: {
    plan: string;
    startDate: Date;
    endDate: Date;
    billingCycle: string;
  };
}

export const MOCK_HOSTEL_RECORDS: Record<string, HostelWizardRecord> = {
  'HST-1001': {
    hostelInfo: {
      hostelName: 'Grand Stay Hostel',
      hostelType: 'Regular Hostel',
      hostelCategory: 'Standard',
      gender: 'Co-ed',
      contactCountryCode: '+91',
      contactNumber: '9876543210',
      email: 'contact@grandstayhostel.com',
      alternateCountryCode: '+91',
      alternateContact: '',
      website: 'https://grandstayhostel.com',
      logoFileName: '',
    },
    address: {
      addressLine1: '221 Banjara Hills Road',
      addressLine2: 'Near City Mall',
      country: 'India',
      state: 'Telangana',
      city: 'Hyderabad',
      pincode: '500034',
      latitude: '17.4126',
      longitude: '78.4482',
    },
    capacity: { buildings: 2, floors: 5, rooms: 150, totalBeds: 500 },
    facilities: {
      wifi: true,
      mess: true,
      laundry: true,
      washingMachine: false,
      parking: true,
      housekeeping: true,
      security: true,
      cctv: true,
      gym: false,
      commonRoom: true,
      studyRoom: false,
      powerBackup: true,
      waterFacility: true,
      otherFacility: '',
    },
    admin: {
      firstName: 'Rakesh',
      lastName: 'Verma',
      mobileNumber: '9876543210',
      email: 'rakesh.verma@grandstayhostel.com',
      username: 'rakesh.verma',
      tempPassword: 'Kj8mPz2qXr!',
      sendEmail: true,
      sendSms: true,
    },
    subscription: {
      plan: 'Standard',
      startDate: new Date('2026-09-18'),
      endDate: new Date('2027-09-17'),
      billingCycle: 'Yearly',
    },
  },
  'HST-1002': {
    hostelInfo: {
      hostelName: 'Royal Palms Luxury Hostel',
      hostelType: 'Regular Hostel',
      hostelCategory: 'Premium',
      gender: 'Female',
      contactCountryCode: '+91',
      contactNumber: '9123456789',
      email: 'hello@royalpalmshostel.com',
      alternateCountryCode: '+91',
      alternateContact: '9123450000',
      website: 'https://royalpalmshostel.com',
      logoFileName: '',
    },
    address: {
      addressLine1: '48 MG Road',
      addressLine2: '',
      country: 'India',
      state: 'Karnataka',
      city: 'Bangalore',
      pincode: '560001',
      latitude: '12.9758',
      longitude: '77.6045',
    },
    capacity: { buildings: 1, floors: 8, rooms: 90, totalBeds: 220 },
    facilities: {
      wifi: true,
      mess: true,
      laundry: true,
      washingMachine: true,
      parking: true,
      housekeeping: true,
      security: true,
      cctv: true,
      gym: true,
      commonRoom: true,
      studyRoom: true,
      powerBackup: true,
      waterFacility: true,
      otherFacility: 'Rooftop lounge',
    },
    admin: {
      firstName: 'Anish',
      lastName: 'Kumar',
      mobileNumber: '9123456789',
      email: 'anish.kumar@royalpalmshostel.com',
      username: 'anish.kumar',
      tempPassword: 'Qw4nTr9vLp!',
      sendEmail: true,
      sendSms: false,
    },
    subscription: {
      plan: 'Premium',
      startDate: new Date('2026-09-17'),
      endDate: new Date('2027-03-17'),
      billingCycle: 'Monthly',
    },
  },
  'HST-1003': {
    hostelInfo: {
      hostelName: 'City Center PG & Hostel',
      hostelType: 'College Hostel',
      hostelCategory: 'Economy',
      gender: 'Male',
      contactCountryCode: '+91',
      contactNumber: '9988776655',
      email: 'info@citycenterpg.com',
      alternateCountryCode: '+91',
      alternateContact: '',
      website: '',
      logoFileName: '',
    },
    address: {
      addressLine1: '12 Anna Salai',
      addressLine2: 'Block C',
      country: 'India',
      state: 'Tamil Nadu',
      city: 'Chennai',
      pincode: '600002',
      latitude: '',
      longitude: '',
    },
    capacity: { buildings: 1, floors: 3, rooms: 60, totalBeds: 180 },
    facilities: {
      wifi: true,
      mess: true,
      laundry: false,
      washingMachine: false,
      parking: false,
      housekeeping: true,
      security: true,
      cctv: false,
      gym: false,
      commonRoom: false,
      studyRoom: true,
      powerBackup: true,
      waterFacility: true,
      otherFacility: '',
    },
    admin: {
      firstName: 'Suresh',
      lastName: 'Raina',
      mobileNumber: '9988776655',
      email: 'suresh.raina@citycenterpg.com',
      username: 'suresh.raina',
      tempPassword: 'Zx7bWn3sYt!',
      sendEmail: true,
      sendSms: true,
    },
    subscription: {
      plan: 'Basic',
      startDate: new Date('2026-09-15'),
      endDate: new Date('2027-09-14'),
      billingCycle: 'Yearly',
    },
  },
};
