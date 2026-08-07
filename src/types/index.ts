export type RoomStatus = 'empty' | 'occupied' | 'booked';
export type PaymentType = 'cash' | 'transfer' | 'unpaid' | 'partial';
export type BookingStatus = 'active' | 'completed' | 'cancelled' | 'on-way';
export type ShiftType = 'pagi' | 'malam';
export type ShiftStatus = 'active' | 'closed';

export type RoomType = 'AC' | 'Non-AC' | 'VIP' | 'Khusus';

export interface Room {
  id: string;
  roomNumber: string;
  status: RoomStatus;
  type: RoomType;
  price: number;
  currentBookingId?: string;
}

export interface Booking {
  id: string;
  guestName: string;
  roomNumber: string;
  checkIn: string; // ISO string
  checkOut?: string; // ISO string
  phone: string;
  deposit: number;
  paymentType: PaymentType;
  status: BookingStatus;
  guarantee: string;
  notes: string;
  totalAmount: number;
  shiftId: string;
}

export interface Beverage {
  id: string;
  name: string;
  stock: number;
  price: number;
  image?: string;
}

export interface BeverageSale {
  id: string;
  beverageId: string;
  beverageName: string;
  quantity: number;
  totalAmount: number;
  timestamp: string;
  shiftId: string;
}

export interface Shift {
  id: string;
  startTime: string;
  endTime?: string;
  type: ShiftType;
  employeeNames?: string[];
  totalRentalIncome: number;
  totalBeverageIncome: number;
  totalOperationalExpense: number;
  operationalExpenseNotes?: string;
  netIncome?: number;
  status: ShiftStatus;
}

export interface OperationalExpense {
  id: string;
  amount: number;
  description: string;
  timestamp: string;
  shiftId: string;
}

export interface Employee {
  id: string;
  name: string;
  phone: string;
  status: 'active' | 'inactive';
  pin: string;
}

export interface EmployeeRegistration {
  id: string;
  name: string;
  phone: string;
  pin: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
}
