import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  getDoc, 
  query, 
  where, 
  onSnapshot,
  Timestamp,
  orderBy,
  limit,
  setDoc,
  getDocFromServer,
  increment
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Room, Booking, Beverage, BeverageSale, Shift, OperationalExpense, RoomType, Employee, EmployeeRegistration } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
  SUBSCRIBE = 'subscribe'
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (operationType === OperationType.SUBSCRIBE) {
    return;
  }
  throw new Error(JSON.stringify(errInfo));
};

export const roomService = {
  subscribeRooms: (callback: (rooms: Room[]) => void) => {
    return onSnapshot(collection(db, 'rooms'), (snapshot) => {
      const rooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
      callback(rooms);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'rooms'));
  },
  updateRoomStatus: async (roomId: string, status: Room['status'], currentBookingId?: string) => {
    try {
      await updateDoc(doc(db, 'rooms', roomId), { status, currentBookingId: currentBookingId || null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
  },
  addRoom: async (roomNumber: string, type: Room['type'], price: number) => {
    try {
      await setDoc(doc(db, 'rooms', `room_${roomNumber}`), {
        roomNumber,
        status: 'empty',
        type,
        price,
        currentBookingId: null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/room_${roomNumber}`);
    }
  },
  updateRoomType: async (roomId: string, type: Room['type'], price: number) => {
    try {
      await updateDoc(doc(db, 'rooms', roomId), { type, price });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
  },
  deleteRoom: async (roomId: string) => {
    try {
      await deleteDoc(doc(db, 'rooms', roomId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `rooms/${roomId}`);
    }
  }
};

export const bookingService = {
  createBooking: async (booking: Omit<Booking, 'id'>) => {
    try {
      const docRef = await addDoc(collection(db, 'bookings'), booking);
      // Update shift total
      if (booking.shiftId) {
        await updateDoc(doc(db, 'shifts', booking.shiftId), {
          totalRentalIncome: increment(booking.totalAmount)
        });
      }
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
    }
  },
  getBooking: async (bookingId: string) => {
    try {
      const docSnap = await getDoc(doc(db, 'bookings', bookingId));
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Booking;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `bookings/${bookingId}`);
    }
  },
  updateBooking: async (bookingId: string, updates: Partial<Booking>) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
    }
  },
  subscribeActiveBookings: (callback: (bookings: Booking[]) => void) => {
    const q = query(collection(db, 'bookings'), where('status', 'in', ['active', 'on-way']));
    return onSnapshot(q, (snapshot) => {
      const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
      callback(bookings);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'bookings'));
  }
};

export const beverageService = {
  subscribeBeverages: (callback: (beverages: Beverage[]) => void) => {
    return onSnapshot(collection(db, 'beverages'), (snapshot) => {
      const beverages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Beverage));
      callback(beverages);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'beverages'));
  },
  addBeverage: async (beverage: Omit<Beverage, 'id'>) => {
    try {
      await addDoc(collection(db, 'beverages'), beverage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'beverages');
    }
  },
  updateBeverage: async (beverageId: string, updates: Partial<Beverage>) => {
    try {
      await updateDoc(doc(db, 'beverages', beverageId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `beverages/${beverageId}`);
    }
  },
  deleteBeverage: async (beverageId: string) => {
    try {
      await deleteDoc(doc(db, 'beverages', beverageId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `beverages/${beverageId}`);
    }
  },
  recordSale: async (sale: Omit<BeverageSale, 'id'>) => {
    try {
      // Update stock
      const bevRef = doc(db, 'beverages', sale.beverageId);
      const bevSnap = await getDoc(bevRef);
      if (bevSnap.exists()) {
        const currentStock = bevSnap.data().stock;
        await updateDoc(bevRef, { stock: currentStock - sale.quantity });
      }
      await addDoc(collection(db, 'beverageSales'), sale);
      
      // Update shift total
      if (sale.shiftId) {
        await updateDoc(doc(db, 'shifts', sale.shiftId), {
          totalBeverageIncome: increment(sale.totalAmount)
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'beverageSales');
    }
  }
};

export const shiftService = {
  getActiveShift: async () => {
    const q = query(collection(db, 'shifts'), where('status', '==', 'active'), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return { id: snap.docs[0].id, ...snap.docs[0].data() } as Shift;
    }
    return null;
  },
  subscribeActiveShift: (callback: (shift: Shift | null) => void) => {
    const q = query(collection(db, 'shifts'), where('status', '==', 'active'), limit(1));
    return onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        callback({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Shift);
      } else {
        callback(null);
      }
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'shifts'));
  },
  startShift: async (shift: Omit<Shift, 'id'>) => {
    try {
      const docRef = await addDoc(collection(db, 'shifts'), shift);
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'shifts');
    }
  },
  closeShift: async (shiftId: string, totals: Partial<Shift>) => {
    try {
      await updateDoc(doc(db, 'shifts', shiftId), { 
        ...totals, 
        status: 'closed', 
        endTime: new Date().toISOString() 
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `shifts/${shiftId}`);
    }
  },
  subscribeClosedShifts: (callback: (shifts: Shift[]) => void) => {
    const q = query(
      collection(db, 'shifts'), 
      where('status', '==', 'closed'),
      orderBy('startTime', 'desc'),
      limit(50)
    );
    return onSnapshot(q, (snapshot) => {
      const shifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
      callback(shifts);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'shifts'));
  }
};

export const settingsService = {
  subscribeRoomPrices: (callback: (prices: Record<RoomType, number>) => void) => {
    return onSnapshot(doc(db, 'settings', 'roomPrices'), (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as Record<RoomType, number>);
      } else {
        // Default prices if not exists
        const defaults: Record<RoomType, number> = {
          'Non-AC': 150000,
          'AC': 200000,
          'VIP': 300000,
          'Khusus': 400000
        };
        callback(defaults);
      }
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'settings/roomPrices'));
  },
  updateRoomPrices: async (prices: Record<RoomType, number>) => {
    try {
      await setDoc(doc(db, 'settings', 'roomPrices'), prices);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/roomPrices');
    }
  }
};

export const employeeService = {
  subscribeEmployees: (callback: (employees: Employee[]) => void) => {
    return onSnapshot(collection(db, 'employees'), (snapshot) => {
      const employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      callback(employees);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'employees'));
  },
  addEmployee: async (employee: Omit<Employee, 'id'>) => {
    try {
      await addDoc(collection(db, 'employees'), employee);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'employees');
    }
  },
  updateEmployee: async (employeeId: string, updates: Partial<Employee>) => {
    try {
      await updateDoc(doc(db, 'employees', employeeId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `employees/${employeeId}`);
    }
  },
  deleteEmployee: async (employeeId: string) => {
    try {
      await deleteDoc(doc(db, 'employees', employeeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `employees/${employeeId}`);
    }
  }
};

export const registrationService = {
  subscribeRegistrations: (callback: (regs: EmployeeRegistration[]) => void) => {
    return onSnapshot(collection(db, 'registrations'), (snapshot) => {
      const regs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EmployeeRegistration));
      callback(regs);
    }, (error) => handleFirestoreError(error, OperationType.SUBSCRIBE, 'registrations'));
  },
  addRegistration: async (reg: Omit<EmployeeRegistration, 'id'>) => {
    try {
      await addDoc(collection(db, 'registrations'), reg);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'registrations');
    }
  },
  updateRegistrationStatus: async (regId: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'registrations', regId), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `registrations/${regId}`);
    }
  }
};

export async function testConnection() {
  try {
    // Try to get a non-existent doc to test connectivity
    await getDocFromServer(doc(db, 'settings', 'connection_test'));
    console.log("Firestore connection test successful");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
    // Skip logging for other errors, as this is simply a connection test.
  }
}

testConnection();
