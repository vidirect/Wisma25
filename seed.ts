import { db } from './src/lib/firebase';
import { collection, doc, setDoc, getDocs } from 'firebase/firestore';

const seedData = async () => {
  // Seed Rooms
  const roomsRef = collection(db, 'rooms');
  const roomsSnap = await getDocs(roomsRef);
  if (roomsSnap.empty) {
    for (let i = 1; i <= 10; i++) {
      const roomNumber = i.toString().padStart(2, '0');
      await setDoc(doc(roomsRef, `room_${roomNumber}`), {
        roomNumber,
        status: 'empty',
        currentBookingId: null
      });
    }
    console.log('Rooms seeded');
  }

  // Seed Beverages
  const bevsRef = collection(db, 'beverages');
  const bevsSnap = await getDocs(bevsRef);
  if (bevsSnap.empty) {
    const initialBevs = [
      { name: 'Aqua 600ml', price: 5000, stock: 50 },
      { name: 'Teh Pucuk', price: 4000, stock: 30 },
      { name: 'Coca Cola', price: 7000, stock: 20 },
      { name: 'Pocari Sweat', price: 8000, stock: 25 }
    ];
    for (const bev of initialBevs) {
      await setDoc(doc(bevsRef), bev);
    }
    console.log('Beverages seeded');
  }
};

seedData();
