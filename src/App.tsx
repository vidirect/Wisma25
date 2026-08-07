import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Bed, 
  Beer, 
  ClipboardList, 
  LogOut, 
  Plus, 
  User, 
  Clock, 
  Phone, 
  CreditCard, 
  AlertCircle,
  CheckCircle2,
  XCircle,
  Search,
  FileText,
  TrendingUp,
  ArrowRightLeft,
  Settings,
  Package,
  Edit,
  Trash2,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './lib/firebase';
import { signInAnonymously, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { roomService, bookingService, beverageService, shiftService, settingsService, employeeService, registrationService } from './services/firestore';
import { Room, Booking, Beverage, Shift, BeverageSale, OperationalExpense, RoomType, Employee, EmployeeRegistration } from './types';
import { format } from 'date-fns';
import { generateShiftReport, downloadPDF } from './utils/pdfGenerator';
import { collection, query, where, getDocs, onSnapshot, doc, setDoc, addDoc, updateDoc, increment } from 'firebase/firestore';

const APP_PIN = '877887';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [verifiedEmployee, setVerifiedEmployee] = useState<Employee | null>(null);
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [employeeShiftMode, setEmployeeShiftMode] = useState<'shift' | 'read_only' | null>(null);
  const [showShiftPromptModal, setShowShiftPromptModal] = useState(false);
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);

  const [activeTab, setActiveTab] = useState<'monitor' | 'sales' | 'inventory' | 'employees' | 'history' | 'settings'>('monitor');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [beverages, setBeverages] = useState<Beverage[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [registrations, setRegistrations] = useState<EmployeeRegistration[]>([]);
  const [closedShifts, setClosedShifts] = useState<Shift[]>([]);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [roomPrices, setRoomPrices] = useState<Record<RoomType, number>>({
    'Non-AC': 150000,
    'AC': 200000,
    'VIP': 300000,
    'Khusus': 400000
  });
  const [loading, setLoading] = useState(true);
  const [showInitConfirm, setShowInitConfirm] = useState(false);
  const [showInitSuccess, setShowInitSuccess] = useState(false);
  const [statusModal, setStatusModal] = useState<{ type: 'success' | 'error' | 'info', title: string, message: string } | null>(null);

  const showStatus = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setStatusModal({ title, message, type });
  };

  const isAdmin = isPinVerified && !verifiedEmployee;
  const isReadOnly = !isAdmin && (!activeShift || employeeShiftMode === 'read_only');

  useEffect(() => {
    if (isPinVerified && verifiedEmployee && !activeShift && !employeeShiftMode) {
      setShowShiftPromptModal(true);
    } else {
      setShowShiftPromptModal(false);
    }
  }, [isPinVerified, verifiedEmployee, activeShift, employeeShiftMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error("Anonymous auth failed", e);
        }
      }
      setUser(user);
      
      // Check if already verified in this session
      const verified = sessionStorage.getItem('pin_verified') === 'true';
      const empData = sessionStorage.getItem('verified_employee');
      setIsPinVerified(verified);
      if (empData) setVerifiedEmployee(JSON.parse(empData));
      
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    // Always subscribe to employees so PIN authentication works for employees
    const unsubEmployees = employeeService.subscribeEmployees(setEmployees);

    if (!isPinVerified) {
      return () => {
        unsubEmployees();
      };
    }

    const unsubRooms = roomService.subscribeRooms(setRooms);
    const unsubBevs = beverageService.subscribeBeverages(setBeverages);
    const unsubPrices = settingsService.subscribeRoomPrices(setRoomPrices);
    const unsubShift = shiftService.subscribeActiveShift(setActiveShift);
    const unsubRegs = registrationService.subscribeRegistrations((regs) => {
      console.log('Registrations updated:', regs);
      setRegistrations(regs);
    });
    const unsubClosedShifts = shiftService.subscribeClosedShifts(setClosedShifts);
    
    return () => {
      unsubRooms();
      unsubBevs();
      unsubPrices();
      unsubShift();
      unsubEmployees();
      unsubRegs();
      unsubClosedShifts();
    };
  }, [isPinVerified, user]);

  // Auto-backup check
  useEffect(() => {
    if (!isPinVerified) return;
    
    const checkBackup = () => {
      const now = new Date();
      const lastBackup = localStorage.getItem('last_backup_date');
      const todayStr = format(now, 'yyyy-MM-dd');
      
      if (now.getHours() >= 18 && lastBackup !== todayStr) {
        console.log("Triggering auto-backup...");
        localStorage.setItem('last_backup_date', todayStr);
      }
    };

    const interval = setInterval(checkBackup, 60000);
    return () => clearInterval(interval);
  }, [isPinVerified]);

  const processPinVerification = (pinValue: string) => {
    if (pinValue.length !== 6) return false;

    // Check Master PIN
    if (pinValue === APP_PIN) {
      setIsPinVerified(true);
      sessionStorage.setItem('pin_verified', 'true');
      setPinError(false);
      return true;
    }

    // Check Employee PINs
    const emp = employees.find(e => e.pin === pinValue && e.status === 'active');
    if (emp) {
      setIsPinVerified(true);
      setVerifiedEmployee(emp);
      sessionStorage.setItem('pin_verified', 'true');
      sessionStorage.setItem('verified_employee', JSON.stringify(emp));
      setPinError(false);
      return true;
    } else {
      setPinError(true);
      return false;
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processPinVerification(pinInput);
  };

  const handlePinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPinInput(val);
    if (pinError) setPinError(false);

    if (val.length === 6) {
      processPinVerification(val);
    }
  };

  const handleLogout = async () => {
    setIsPinVerified(false);
    setVerifiedEmployee(null);
    sessionStorage.removeItem('pin_verified');
    sessionStorage.removeItem('verified_employee');
    await signOut(auth);
  };

  if (loading) return <div className="flex items-center justify-center h-screen bg-stone-50"><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-12 h-12 border-4 border-stone-900 border-t-transparent rounded-full" /></div>;

  if (!isPinVerified) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-stone-100 p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center space-y-6 md:space-y-8 border border-stone-200"
        >
          <div className="w-16 h-16 md:w-20 md:h-20 bg-stone-900 rounded-2xl md:rounded-3xl flex items-center justify-center mx-auto shadow-xl">
            <Settings className="text-white w-8 h-8 md:w-10 md:h-10" />
          </div>
          
          <div className="space-y-1 md:space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">Akses Sistem</h1>
            <p className="text-stone-500 text-xs md:text-sm">Masukkan PIN Keamanan untuk melanjutkan</p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div className="relative">
              <input 
                type="password"
                maxLength={6}
                value={pinInput}
                onChange={handlePinInputChange}
                placeholder="••••••"
                className={`w-full text-center text-3xl tracking-[1em] py-4 bg-stone-50 border-2 rounded-2xl outline-none transition-all ${
                  pinError ? 'border-red-500 shake bg-red-50 text-red-600' : 'border-stone-200 focus:border-stone-900'
                }`}
                autoFocus
              />
              {pinError && (
                <motion.p 
                  initial={{ opacity: 0, y: -4 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  className="text-red-500 text-xs md:text-sm font-bold mt-3 text-center"
                >
                  PIN salah. Silakan masukkan 6 digit PIN yang benar.
                </motion.p>
              )}
            </div>

            <button 
              type="submit"
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
            >
              Buka Akses
              <ArrowRightLeft size={18} />
            </button>

            <button 
              type="button"
              onClick={() => setShowForgotPin(true)}
              className="text-stone-400 text-xs font-bold uppercase tracking-widest hover:text-stone-900 transition-colors"
            >
              Lupa PIN?
            </button>

            <div className="pt-4 border-t border-stone-100">
              <p className="text-stone-400 text-xs mb-3">Karyawan Baru?</p>
              <button 
                type="button"
                onClick={() => setShowRegisterModal(true)}
                className="w-full py-3 border-2 border-stone-900 text-stone-900 rounded-2xl font-bold hover:bg-stone-900 hover:text-white transition-all"
              >
                Daftar Sebagai Karyawan
              </button>
            </div>
          </form>
        </motion.div>

        {showRegisterModal && (
          <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
              <h3 className="text-2xl font-bold text-stone-900">Pendaftaran Karyawan</h3>
              <EmployeeRegisterForm onComplete={() => setShowRegisterModal(false)} showStatus={showStatus} />
            </motion.div>
          </div>
        )}

        {showForgotPin && (
          <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-2xl font-bold text-stone-900">Lupa PIN?</h3>
              <p className="text-stone-500">Silakan hubungi Administrator untuk mereset PIN Anda melalui menu **Data Karyawan**.</p>
              <button 
                onClick={() => setShowForgotPin(false)} 
                className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
              >
                Mengerti
              </button>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-stone-50 overflow-hidden font-sans">
      {/* Sidebar - Desktop & Tablet */}
      <aside className="hidden md:flex md:w-20 lg:w-64 bg-white border-r border-stone-200 flex-col p-4 lg:p-6 space-y-8 transition-all duration-300">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center shrink-0">
            <Bed className="text-white size-6" />
          </div>
          <span className="font-bold text-lg tracking-tight hidden lg:block">Wisma Manager</span>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto">
          <NavItem active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<LayoutDashboard size={20} />} label="Monitor Kamar" hideLabelOnMd />
          <NavItem active={activeTab === 'sales'} onClick={() => setActiveTab('sales')} icon={<Beer size={20} />} label="Penjualan Minuman" hideLabelOnMd />
          <NavItem active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} icon={<Package size={20} />} label="Stok Minuman" hideLabelOnMd />
          {isAdmin && <NavItem active={activeTab === 'employees'} onClick={() => setActiveTab('employees')} icon={<Users size={20} />} label="Data Karyawan" hideLabelOnMd />}
          <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<ClipboardList size={20} />} label="Histori & Laporan" hideLabelOnMd />
          {isAdmin && <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings size={20} />} label="Pengaturan Kamar" hideLabelOnMd />}
        </nav>

        {isAdmin && (
          <div className="px-0 lg:px-2 pb-4">
            <button 
              onClick={() => setShowInitConfirm(true)}
              className="w-full flex items-center justify-center lg:justify-start gap-3 px-4 py-3 rounded-2xl text-amber-600 hover:bg-amber-50 transition-all border border-amber-100"
              title="Inisialisasi Data"
            >
              <Settings size={20} />
              <span className="text-sm font-semibold hidden lg:block">Inisialisasi Data</span>
            </button>
          </div>
        )}

        <div className="pt-6 border-t border-stone-100">
          <div className="flex items-center justify-center lg:justify-start gap-3 px-0 lg:px-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center border border-stone-200 shrink-0">
              <User className="text-stone-400" size={20} />
            </div>
            <div className="flex-1 min-w-0 hidden lg:block">
              <p className="text-sm font-semibold truncate">{verifiedEmployee ? verifiedEmployee.name : 'Administrator'}</p>
              <p className="text-xs text-stone-400 truncate">{activeShift ? `Shift ${activeShift.type}` : isReadOnly ? 'Mode Lihat Saja' : 'Shift Belum Aktif'}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            title="Keluar"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium hidden lg:block">Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-10 gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">
              {activeTab === 'monitor' && 'Monitor Kamar'}
              {activeTab === 'sales' && 'Penjualan Minuman'}
              {activeTab === 'inventory' && 'Pengelolaan Stok Minuman'}
              {activeTab === 'employees' && 'Pengelolaan Data Karyawan'}
              {activeTab === 'history' && 'Histori & Laporan'}
              {activeTab === 'settings' && 'Pengaturan Kamar'}
            </h2>
            <p className="text-stone-500 text-sm mt-1">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            {activeShift ? (
              <div className="flex items-center gap-3 bg-white p-2.5 pr-4 rounded-2xl border border-stone-200 shadow-sm w-full md:w-auto">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeShift.type === 'pagi' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                  <Clock size={20} />
                </div>
                <div className="min-w-0 pr-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Shift Aktif</p>
                  <p className="font-bold text-stone-900 text-xs md:text-sm truncate">
                    Shift {activeShift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'}
                  </p>
                </div>
                <button
                  onClick={() => setShowEndShiftModal(true)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-1.5 shrink-0 ml-auto"
                >
                  <LogOut size={14} />
                  Tutup Shift
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-white p-2.5 pr-4 rounded-2xl border border-stone-200 shadow-sm w-full md:w-auto justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
                    <Clock size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Status Shift</p>
                    <p className="font-bold text-stone-600 text-xs md:text-sm">
                      {isReadOnly ? 'Mode Lihat Saja' : 'Belum Ada Shift'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStartShiftModal(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-1.5 shrink-0 ml-auto"
                >
                  <Plus size={14} />
                  Masuk Shift
                </button>
              </div>
            )}
          </div>
        </header>

        {isReadOnly && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="font-bold text-amber-900 text-xs sm:text-sm">Mode Lihat Saja (Read-Only)</p>
                <p className="text-amber-700 text-xs">Anda belum masuk shift. Masuk shift terlebih dahulu untuk dapat mengubah atau menambah data.</p>
              </div>
            </div>
            <button
              onClick={() => setShowStartShiftModal(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap self-end sm:self-auto"
            >
              Masuk Shift Sekarang
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'monitor' && <RoomMonitor rooms={rooms} activeShift={activeShift} roomPrices={roomPrices} showStatus={showStatus} isReadOnly={isReadOnly} onRequestStartShift={() => setShowStartShiftModal(true)} />}
            {activeTab === 'sales' && <BeveragePOS beverages={beverages} activeShift={activeShift} showStatus={showStatus} isReadOnly={isReadOnly} onRequestStartShift={() => setShowStartShiftModal(true)} />}
            {activeTab === 'inventory' && <BeverageInventory beverages={beverages} showStatus={showStatus} isReadOnly={isReadOnly} />}
            {activeTab === 'employees' && <EmployeeManagement employees={employees} registrations={registrations} showStatus={showStatus} />}
            {activeTab === 'history' && <HistoryReports shifts={closedShifts} />}
            {activeTab === 'settings' && <RoomManagement rooms={rooms} roomPrices={roomPrices} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - Mobile Only */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex justify-around items-center p-2 z-40">
        <MobileNavItem active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon={<LayoutDashboard size={20} />} label="Monitor" />
        <MobileNavItem active={activeTab === 'sales'} onClick={() => setActiveTab('sales')} icon={<Beer size={20} />} label="POS" />
        <MobileNavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<ClipboardList size={20} />} label="Laporan" />
        <button 
          onClick={handleLogout}
          className="flex flex-col items-center gap-1 p-2 text-stone-400"
        >
          <LogOut size={20} />
          <span className="text-[10px] font-bold uppercase">Keluar</span>
        </button>
      </nav>

      {showInitConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <Settings size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Inisialisasi Data?</h3>
            <p className="text-stone-500">Ini akan membuat data awal untuk Kamar dan Minuman. Data yang sudah ada mungkin akan tertimpa.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowInitConfirm(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={async () => {
                  const roomsRef = collection(db, 'rooms');
                  for (let i = 1; i <= 10; i++) {
                    const num = i.toString().padStart(2, '0');
                    const type = i <= 5 ? 'AC' : 'Non-AC';
                    const price = type === 'AC' ? 200000 : 150000;
                    await setDoc(doc(roomsRef, `room_${num}`), { 
                      roomNumber: num, 
                      status: 'empty',
                      type,
                      price,
                      currentBookingId: null
                    });
                  }
                  const bevsRef = collection(db, 'beverages');
                  const initialBevs = [
                    { name: 'Aqua 600ml', price: 5000, stock: 50 },
                    { name: 'Teh Pucuk', price: 4000, stock: 30 },
                    { name: 'Coca Cola', price: 7000, stock: 20 }
                  ];
                  for (const bev of initialBevs) {
                    await addDoc(bevsRef, bev);
                  }
                  setShowInitConfirm(false);
                  setShowInitSuccess(true);
                }} 
                className="flex-1 py-4 bg-amber-600 text-white rounded-2xl font-bold shadow-lg hover:bg-amber-700 transition-all"
              >
                Ya, Inisialisasi
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showInitSuccess && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Berhasil!</h3>
            <p className="text-stone-500">Data awal berhasil diinisialisasi.</p>
            <button 
              onClick={() => setShowInitSuccess(false)} 
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
            >
              Tutup
            </button>
          </motion.div>
        </div>
      )}

      {statusModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
              statusModal.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 
              statusModal.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {statusModal.type === 'success' ? <CheckCircle2 size={32} /> : 
               statusModal.type === 'error' ? <XCircle size={32} /> : <AlertCircle size={32} />}
            </div>
            <h3 className="text-2xl font-bold text-stone-900">{statusModal.title}</h3>
            <p className="text-stone-500">{statusModal.message}</p>
            <button 
              onClick={() => setStatusModal(null)} 
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
            >
              Tutup
            </button>
          </motion.div>
        </div>
      )}

      {/* Shift Modals */}
      {showShiftPromptModal && verifiedEmployee && (
        <ShiftPromptModal
          employeeName={verifiedEmployee.name}
          onStartShift={() => {
            setShowShiftPromptModal(false);
            setShowStartShiftModal(true);
          }}
          onReadOnly={() => {
            setShowShiftPromptModal(false);
            setEmployeeShiftMode('read_only');
          }}
        />
      )}

      {showStartShiftModal && (
        <StartShiftModal
          employees={employees}
          onClose={() => setShowStartShiftModal(false)}
          onSuccess={() => {
            setEmployeeShiftMode('shift');
            showStatus('Shift Dimulai', 'Shift baru telah berhasil dibuka!', 'success');
          }}
        />
      )}

      {showEndShiftModal && activeShift && (
        <EndShiftModal
          activeShift={activeShift}
          onClose={() => setShowEndShiftModal(false)}
          showStatus={showStatus}
          onShiftClosed={() => {
            setActiveShift(null);
            setEmployeeShiftMode(null);
          }}
        />
      )}
    </div>
  );
}

// --- Shift Management Modals ---

function ShiftPromptModal({
  employeeName,
  onStartShift,
  onReadOnly
}: {
  employeeName: string,
  onStartShift: () => void,
  onReadOnly: () => void
}) {
  return (
    <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
          <Clock size={32} />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-stone-900">Halo, {employeeName}!</h3>
          <p className="text-stone-500 text-sm mt-2">
            Anda belum masuk shift aktif. Apakah Anda ingin masuk shift sekarang atau hanya melihat data aplikasi?
          </p>
        </div>

        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-left text-xs text-amber-900 space-y-1">
          <p className="font-bold">⚠️ Perhatian Mode Lihat Saja:</p>
          <p>Jika memilih "Lihat Saja", Anda tidak dapat mengubah, menambah, atau menyelesaikan transaksi kamar maupun minuman.</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={onStartShift}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Masuk & Mulai Shift Baru
          </button>
          <button
            onClick={onReadOnly}
            className="w-full py-3.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-2xl font-bold transition-all"
          >
            Lihat Saja (Mode Baca)
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function StartShiftModal({
  employees,
  onClose,
  onSuccess
}: {
  employees: Employee[],
  onClose: () => void,
  onSuccess: () => void
}) {
  const [shiftType, setShiftType] = useState<'pagi' | 'malam'>('pagi');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  };

  const handleStartShift = async () => {
    if (selectedEmployees.length === 0) {
      alert('Pilih minimal 1 karyawan yang bertugas saat shift ini!');
      return;
    }
    setSubmitting(true);
    try {
      const assignedEmployeeNames = employees
        .filter(e => selectedEmployees.includes(e.id))
        .map(e => e.name);

      await shiftService.startShift({
        startTime: new Date().toISOString(),
        type: shiftType,
        employeeNames: assignedEmployeeNames,
        totalRentalIncome: 0,
        totalBeverageIncome: 0,
        totalOperationalExpense: 0,
        status: 'active'
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      alert('Gagal memulai shift: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full space-y-6 shadow-2xl">
        <div className="flex justify-between items-center border-b border-stone-100 pb-4">
          <div>
            <h3 className="text-xl md:text-2xl font-bold text-stone-900">Masuk / Mulai Shift</h3>
            <p className="text-xs md:text-sm text-stone-500">Pilih jenis shift dan karyawan yang bertugas</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600">
            <XCircle size={24} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider block mb-2">Jenis Shift</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShiftType('pagi')}
                className={`p-4 rounded-2xl border-2 font-bold text-sm flex flex-col items-center gap-2 transition-all ${
                  shiftType === 'pagi'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm'
                    : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                }`}
              >
                <Clock size={24} className={shiftType === 'pagi' ? 'text-amber-600' : 'text-stone-400'} />
                Shift Pagi / Siang
              </button>
              <button
                type="button"
                onClick={() => setShiftType('malam')}
                className={`p-4 rounded-2xl border-2 font-bold text-sm flex flex-col items-center gap-2 transition-all ${
                  shiftType === 'malam'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm'
                    : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                }`}
              >
                <Clock size={24} className={shiftType === 'malam' ? 'text-indigo-600' : 'text-stone-400'} />
                Shift Malam / Dini Hari
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider block mb-2">Karyawan Bertugas</label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {employees.map(emp => (
                <label
                  key={emp.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedEmployees.includes(emp.id)
                      ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
                      : 'border-stone-200 hover:bg-stone-50 text-stone-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <User size={18} className={selectedEmployees.includes(emp.id) ? 'text-stone-300' : 'text-stone-400'} />
                    <span className="font-semibold text-sm">{emp.name}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedEmployees.includes(emp.id)}
                    onChange={() => toggleEmployee(emp.id)}
                    className="w-4 h-4 rounded accent-stone-900"
                  />
                </label>
              ))}
              {employees.length === 0 && (
                <p className="text-xs text-stone-400 italic text-center py-4">Belum ada data karyawan terdaftar</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3.5 bg-stone-100 text-stone-600 rounded-2xl font-bold hover:bg-stone-200 transition-all"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={submitting || selectedEmployees.length === 0}
            onClick={handleStartShift}
            className="flex-1 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg disabled:opacity-50"
          >
            {submitting ? 'Memproses...' : 'Mulai Shift Baru'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function EndShiftModal({
  activeShift,
  onClose,
  showStatus,
  onShiftClosed
}: {
  activeShift: Shift,
  onClose: () => void,
  showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void,
  onShiftClosed: () => void
}) {
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [expenseNote, setExpenseNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [rentalTotal, setRentalTotal] = useState<number>(0);
  const [beverageTotal, setBeverageTotal] = useState<number>(0);

  useEffect(() => {
    const fetchRental = async () => {
      const q = query(collection(db, 'bookings'), where('shiftId', '==', activeShift.id));
      const snap = await getDocs(q);
      let sum = 0;
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status === 'completed' || d.status === 'active') {
          sum += Number(d.totalAmount) || 0;
        }
      });
      setRentalTotal(sum);
    };

    const fetchBeverages = async () => {
      const q = query(collection(db, 'beverageSales'), where('shiftId', '==', activeShift.id));
      const snap = await getDocs(q);
      let sum = 0;
      snap.docs.forEach(doc => {
        sum += Number(doc.data().totalAmount) || 0;
      });
      setBeverageTotal(sum);
    };

    fetchRental();
    fetchBeverages();
  }, [activeShift]);

  const netSetoran = rentalTotal + beverageTotal - Number(expenseAmount || 0);

  const handleCloseShift = async () => {
    setSubmitting(true);
    try {
      const closedData: Partial<Shift> = {
        totalRentalIncome: rentalTotal,
        totalBeverageIncome: beverageTotal,
        totalOperationalExpense: Number(expenseAmount || 0),
        operationalExpenseNotes: expenseNote || '-',
        netIncome: netSetoran,
        status: 'closed',
        endTime: new Date().toISOString()
      };

      await shiftService.closeShift(activeShift.id, closedData);

      const fullClosedShift: Shift = {
        ...activeShift,
        ...closedData as Shift
      };
      const doc = generateShiftReport(fullClosedShift, [], [], []);
      downloadPDF(doc, `Laporan-Shift-${activeShift.type}-${format(new Date(), 'dd-MM-yyyy')}.pdf`);

      onShiftClosed();
      showStatus('Shift Ditutup', 'Shift berhasil ditutup dan laporan PDF telah diunduh!', 'success');
      onClose();
    } catch (e: any) {
      showStatus('Gagal Tutup Shift', e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full space-y-6 shadow-2xl">
        <div className="flex justify-between items-center border-b border-stone-100 pb-4">
          <div>
            <h3 className="text-xl md:text-2xl font-bold text-stone-900">Tutup Shift & Setoran</h3>
            <p className="text-xs md:text-sm text-stone-500">
              Shift {activeShift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'} • {format(new Date(), 'dd MMMM yyyy')}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600">
            <XCircle size={24} />
          </button>
        </div>

        <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-stone-600">Total Pemasukan Sewa Kamar</span>
            <span className="font-bold text-stone-900">Rp {rentalTotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-stone-600">Total Pemasukan Minuman</span>
            <span className="font-bold text-stone-900">Rp {beverageTotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center text-red-600">
            <span>Pengeluaran Operasional Shift</span>
            <span className="font-bold">- Rp {Number(expenseAmount || 0).toLocaleString()}</span>
          </div>
          <div className="pt-2 border-t border-stone-200 flex justify-between items-center text-base font-bold text-emerald-800">
            <span>Total Setoran Bersih</span>
            <span className="text-lg">Rp {netSetoran.toLocaleString()}</span>
          </div>
        </div>

        <div className="space-y-4">
          <Input
            label="Pengeluaran Operasional Shift (Rp)"
            type="number"
            value={expenseAmount}
            onChange={v => setExpenseAmount(Number(v))}
            placeholder="0"
          />
          <Input
            label="Keterangan / Catatan Pengeluaran"
            value={expenseNote}
            onChange={v => setExpenseNote(v)}
            placeholder="Contoh: Beli token listrik, sabun pembersih, dll."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3.5 bg-stone-100 text-stone-600 rounded-2xl font-bold hover:bg-stone-200 transition-all"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleCloseShift}
            className="flex-1 py-3.5 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {submitting ? 'Menutup...' : 'Tutup Shift & Cetak PDF'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function NavItem({ active, onClick, icon, label, hideLabelOnMd }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, hideLabelOnMd?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-center lg:justify-start gap-3 px-4 py-3 rounded-2xl transition-all ${
        active 
          ? 'bg-stone-900 text-white shadow-lg shadow-stone-200' 
          : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'
      }`}
      title={label}
    >
      {icon}
      <span className={`text-sm font-semibold ${hideLabelOnMd ? 'hidden lg:block' : ''}`}>{label}</span>
    </button>
  );
}

function MobileNavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 transition-all ${
        active ? 'text-stone-900' : 'text-stone-400'
      }`}
    >
      <div className={active ? 'scale-110 transition-transform' : ''}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      {active && <motion.div layoutId="activeTab" className="w-1 h-1 bg-stone-900 rounded-full mt-0.5" />}
    </button>
  );
}

// --- Components ---

function RoomMonitor({ 
  rooms, 
  activeShift, 
  roomPrices, 
  showStatus, 
  isReadOnly, 
  onRequestStartShift 
}: { 
  rooms: Room[], 
  activeShift: Shift | null, 
  roomPrices: Record<RoomType, number>, 
  showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void,
  isReadOnly?: boolean,
  onRequestStartShift?: () => void
}) {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showAddRoomModal, setShowAddRoomModal] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomType, setNewRoomType] = useState<RoomType>('AC');

  const stats = {
    total: rooms.length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    empty: rooms.filter(r => r.status === 'empty').length,
    booked: rooms.filter(r => r.status === 'booked').length,
  };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <StatCard label="Total Kamar" value={stats.total} icon={<Bed className="text-stone-400" />} />
        <StatCard label="Terisi" value={stats.occupied} icon={<CheckCircle2 className="text-emerald-500" />} color="emerald" />
        <StatCard label="Kosong" value={stats.empty} icon={<AlertCircle className="text-amber-500" />} color="amber" />
        <StatCard label="Dipesan" value={stats.booked} icon={<Clock className="text-indigo-500" />} color="indigo" />
      </div>

      {/* Room Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
        {rooms.map(room => (
          <RoomCard 
            key={room.id} 
            room={room} 
            roomPrices={roomPrices}
            onClick={() => {
              setSelectedRoom(room);
              setShowBookingModal(true);
            }} 
          />
        ))}
        <button 
          onClick={() => setShowAddRoomModal(true)}
          className="aspect-square rounded-3xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center gap-3 text-stone-400 hover:border-stone-400 hover:text-stone-600 transition-all"
        >
          <Plus size={32} />
          <span className="font-semibold">Tambah Kamar</span>
        </button>
      </div>

      {showAddRoomModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl"
          >
            <h3 className="text-2xl font-bold text-stone-900">Tambah Kamar Baru</h3>
            <div className="space-y-4">
              <Input 
                label="Nomor Kamar" 
                value={newRoomNumber} 
                onChange={setNewRoomNumber} 
                placeholder="Contoh: 11"
              />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Tipe Kamar</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={newRoomType}
                  onChange={e => setNewRoomType(e.target.value as any)}
                >
                  <option value="Non-AC">Non-AC (Rp {roomPrices['Non-AC'].toLocaleString()})</option>
                  <option value="AC">AC (Rp {roomPrices['AC'].toLocaleString()})</option>
                  <option value="VIP">VIP (Rp {roomPrices['VIP'].toLocaleString()})</option>
                  <option value="Khusus">Khusus (Rp {roomPrices['Khusus'].toLocaleString()})</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button 
                onClick={() => {
                  setShowAddRoomModal(false);
                  setNewRoomNumber('');
                }} 
                className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold hover:bg-stone-200 transition-all"
              >
                Batal
              </button>
              <button 
                onClick={async () => {
                  if (newRoomNumber) {
                    const price = roomPrices[newRoomType];
                    await roomService.addRoom(newRoomNumber, newRoomType, price);
                    setShowAddRoomModal(false);
                    setNewRoomNumber('');
                  }
                }} 
                className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg"
              >
                Simpan Kamar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showBookingModal && selectedRoom && (
        <BookingModal 
          room={selectedRoom} 
          activeShift={activeShift}
          roomPrices={roomPrices}
          onClose={() => setShowBookingModal(false)}
          isReadOnly={isReadOnly}
          onRequestStartShift={onRequestStartShift}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color = 'stone' }: { label: string, value: number, icon: React.ReactNode, color?: string }) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-3xl border border-stone-200 shadow-sm flex flex-col md:block">
      <div className="flex justify-between items-start mb-2 md:mb-4">
        <div className={`w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center bg-${color}-50`}>
          {icon}
        </div>
      </div>
      <p className="text-stone-500 text-[10px] md:text-sm font-medium">{label}</p>
      <p className="text-xl md:text-3xl font-bold text-stone-900 mt-0.5 md:mt-1">{value}</p>
    </div>
  );
}

function RoomCard({ room, onClick, roomPrices }: { room: Room, onClick: () => void, roomPrices: Record<RoomType, number>, key?: string }) {
  const statusColors = {
    empty: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    occupied: 'bg-stone-900 text-white border-stone-900',
    booked: 'bg-indigo-50 text-indigo-700 border-indigo-100'
  };

  return (
    <motion.button
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`aspect-square rounded-3xl border p-4 md:p-6 flex flex-col justify-between text-left transition-all shadow-sm ${statusColors[room.status]}`}
    >
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <span className="text-xl md:text-2xl font-bold">#{room.roomNumber}</span>
          <span className={`text-[10px] font-bold uppercase mt-0.5 md:mt-1 ${room.status === 'occupied' ? 'text-stone-400' : 'text-stone-500'}`}>
            {room.type || 'Non-AC'}
          </span>
        </div>
        <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider ${room.status === 'occupied' ? 'bg-white/20' : 'bg-current/10'}`}>
          {room.status === 'empty' ? 'Kosong' : room.status === 'occupied' ? 'Terisi' : 'Dipesan'}
        </div>
      </div>
      
      <div className="space-y-0.5 md:space-y-1">
        <p className="text-[10px] md:text-xs opacity-70 font-medium">Harga Sewa</p>
        <p className="font-bold text-xs md:text-sm">
          Rp {room.price?.toLocaleString() || roomPrices[room.type || 'Non-AC']?.toLocaleString()}
        </p>
      </div>
    </motion.button>
  );
}

function BookingModal({ 
  room, 
  activeShift, 
  onClose, 
  roomPrices, 
  isReadOnly, 
  onRequestStartShift 
}: { 
  room: Room, 
  activeShift: Shift | null, 
  onClose: () => void, 
  roomPrices: Record<RoomType, number>,
  isReadOnly?: boolean,
  onRequestStartShift?: () => void
}) {
  const [error, setError] = useState<string | null>(null);
  const [currentBooking, setCurrentBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    guestName: '',
    phone: '',
    guarantee: '',
    notes: '',
    deposit: 0,
    paymentType: 'cash' as any,
    totalAmount: room.price || roomPrices[room.type || 'Non-AC'],
    status: 'active' as any
  });

  useEffect(() => {
    if (room.status !== 'empty' && room.currentBookingId) {
      setLoading(true);
      bookingService.getBooking(room.currentBookingId).then(b => {
        if (b) setCurrentBooking(b);
        setLoading(false);
      });
    }
  }, [room]);

  useEffect(() => {
    if (room.price && room.status === 'empty') {
      setFormData(prev => ({ ...prev, totalAmount: room.price }));
    }
  }, [room]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      setError("Anda dalam Mode Lihat Saja. Silakan masuk shift terlebih dahulu untuk mengubah data!");
      return;
    }
    if (!activeShift) {
      setError("Harap mulai shift terlebih dahulu!");
      return;
    }

    const bookingId = await bookingService.createBooking({
      ...formData,
      roomNumber: room.roomNumber,
      checkIn: new Date().toISOString(),
      shiftId: activeShift.id
    });

    if (bookingId) {
      await roomService.updateRoomStatus(room.id, formData.status === 'on-way' ? 'booked' : 'occupied', bookingId);
      onClose();
    }
  };

  const handleCheckOut = async () => {
    if (isReadOnly) {
      setError("Anda dalam Mode Lihat Saja. Silakan masuk shift terlebih dahulu!");
      return;
    }
    if (!currentBooking) return;
    await bookingService.updateBooking(currentBooking.id, {
      status: 'completed',
      checkOut: new Date().toISOString()
    });
    await roomService.updateRoomStatus(room.id, 'empty');
    onClose();
  };

  const handleCancel = async () => {
    if (isReadOnly) {
      setError("Anda dalam Mode Lihat Saja. Silakan masuk shift terlebih dahulu!");
      return;
    }
    if (!currentBooking) return;
    await bookingService.updateBooking(currentBooking.id, {
      status: 'cancelled',
      checkOut: new Date().toISOString()
    });
    await roomService.updateRoomStatus(room.id, 'empty');
    onClose();
  };

  const handleCheckIn = async () => {
    if (isReadOnly) {
      setError("Anda dalam Mode Lihat Saja. Silakan masuk shift terlebih dahulu!");
      return;
    }
    if (!currentBooking) return;
    await bookingService.updateBooking(currentBooking.id, {
      status: 'active'
    });
    await roomService.updateRoomStatus(room.id, 'occupied', currentBooking.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative"
      >
        {error && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-50 flex items-center justify-center p-8 text-center">
            <div className="space-y-6">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-2xl font-bold text-stone-900">Peringatan</h3>
              <p className="text-stone-500">{error}</p>
              <button onClick={() => setError(null)} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold">Mengerti</button>
            </div>
          </div>
        )}
        <div className="p-4 md:p-8 border-b border-stone-100 flex justify-between items-center bg-stone-50">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl md:text-2xl font-bold text-stone-900">Kamar #{room.roomNumber}</h3>
              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                room.type === 'AC' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
              }`}>
                {room.type || 'Non-AC'}
              </span>
            </div>
            <p className="text-stone-500 text-xs md:text-sm">{room.status === 'empty' ? 'Input Data Tamu Baru' : 'Detail Tamu Saat Ini'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-full transition-colors"><XCircle size={24} /></button>
        </div>

        {loading ? (
          <div className="p-20 text-center text-stone-400">Memuat data...</div>
        ) : currentBooking ? (
          <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Nama Tamu</p>
                  <p className="text-xl font-bold text-stone-900">{currentBooking.guestName}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Nomor HP</p>
                  <p className="text-stone-600 font-medium">{currentBooking.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Waktu Check-In</p>
                  <p className="text-stone-600 font-medium">{format(new Date(currentBooking.checkIn), 'HH:mm • dd MMM yyyy')}</p>
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Total Biaya</p>
                  <p className="text-xl font-bold text-stone-900">Rp {currentBooking.totalAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Deposit / DP</p>
                  <p className="text-stone-600 font-medium">Rp {currentBooking.deposit.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Status Pembayaran</p>
                  <span className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-bold uppercase tracking-wider">
                    {currentBooking.paymentType}
                  </span>
                </div>
              </div>
            </div>

            {currentBooking.notes && (
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Catatan</p>
                <p className="text-stone-600 text-sm italic">"{currentBooking.notes}"</p>
              </div>
            )}

            <div className="flex gap-4 pt-4">
              {room.status === 'booked' ? (
                <>
                  <button onClick={handleCancel} className="flex-1 py-4 bg-stone-100 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all">Batalkan Booking</button>
                  <button onClick={handleCheckIn} className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg">Check-In Sekarang</button>
                </>
              ) : (
                <button onClick={handleCheckOut} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg">
                  Check-Out & Selesaikan
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-4">
              <Input label="Nama Tamu" value={formData.guestName} onChange={v => setFormData({...formData, guestName: v})} required />
              <Input label="Nomor HP" value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
              <Input label="Jaminan (KTP/SIM)" value={formData.guarantee} onChange={v => setFormData({...formData, guarantee: v})} />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Status Kedatangan</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value})}
                >
                  <option value="active">Check-In Sekarang</option>
                  <option value="on-way">Dalam Perjalanan (Booking)</option>
                </select>
              </div>
            </div>
            
            <div className="space-y-4">
              <Input label="Total Biaya Sewa" type="number" value={formData.totalAmount} onChange={v => setFormData({...formData, totalAmount: Number(v)})} />
              <Input label="Deposit / DP" type="number" value={formData.deposit} onChange={v => setFormData({...formData, deposit: Number(v)})} />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Jenis Pembayaran</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={formData.paymentType}
                  onChange={e => setFormData({...formData, paymentType: e.target.value as any})}
                >
                  <option value="cash">Tunai (Cash)</option>
                  <option value="transfer">Transfer</option>
                  <option value="unpaid">Belum Bayar (BB)</option>
                  <option value="partial">Kurang Bayar</option>
                </select>
              </div>
              <textarea 
                placeholder="Keterangan Tambahan..."
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl h-24 focus:ring-2 focus:ring-stone-900 outline-none resize-none"
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
              />
            </div>

            <div className="col-span-2 pt-4">
              <button type="submit" className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg">
                Simpan Data & Update Kamar
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', required = false, placeholder = '', maxLength }: { label: string, value: any, onChange: (v: string) => void, type?: string, required?: boolean, placeholder?: string, maxLength?: number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">{label}</label>
      <input 
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none transition-all"
      />
    </div>
  );
}

const getBeverageImage = (bev: Beverage): string | null => {
  if (bev.image) return bev.image;
  const name = bev.name.toLowerCase();
  if (
    name.includes('lee mineral') || 
    name.includes('le minerale') || 
    name.includes('le min') || 
    name.includes('mineral')
  ) {
    return '/media/photos/Le Min 1500ml.png';
  }
  return null;
};

function BeverageInventory({ 
  beverages, 
  showStatus,
  isReadOnly 
}: { 
  beverages: Beverage[], 
  showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void,
  isReadOnly?: boolean 
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedBev, setSelectedBev] = useState<Beverage | null>(null);
  const [formData, setFormData] = useState({ name: '', price: 0, stock: 0, image: '' });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      showStatus('Peringatan', 'Anda dalam Mode Lihat Saja. Harap masuk shift terlebih dahulu!', 'error');
      return;
    }
    await beverageService.addBeverage(formData);
    setFormData({ name: '', price: 0, stock: 0, image: '' });
    setShowAddModal(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      showStatus('Peringatan', 'Anda dalam Mode Lihat Saja. Harap masuk shift terlebih dahulu!', 'error');
      return;
    }
    if (selectedBev) {
      await beverageService.updateBeverage(selectedBev.id, formData);
      setShowEditModal(false);
      setSelectedBev(null);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (isReadOnly) {
      showStatus('Peringatan', 'Anda dalam Mode Lihat Saja. Harap masuk shift terlebih dahulu!', 'error');
      return;
    }
    await beverageService.deleteBeverage(id);
    setShowDeleteConfirm(null);
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h3 className="text-xl md:text-2xl font-bold text-stone-900">Daftar Inventaris</h3>
          <p className="text-stone-500 text-xs md:text-sm">Kelola stok dan harga minuman Anda</p>
        </div>
        <button 
          onClick={() => {
            setFormData({ name: '', price: 0, stock: 0, image: '' });
            setShowAddModal(true);
          }}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg"
        >
          <Plus size={20} />
          Tambah Minuman Baru
        </button>
      </div>

      <div className="bg-white rounded-3xl md:rounded-[2.5rem] border border-stone-200 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px] md:min-w-full">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-6 md:px-8 py-4 md:py-5 text-xs font-bold text-stone-400 uppercase tracking-wider">Nama Minuman</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-xs font-bold text-stone-400 uppercase tracking-wider">Harga Jual</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-xs font-bold text-stone-400 uppercase tracking-wider">Stok Saat Ini</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-xs font-bold text-stone-400 uppercase tracking-wider text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {beverages.map(bev => (
                <tr key={bev.id} className="hover:bg-stone-50/50 transition-colors">
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 md:w-10 md:h-10 bg-stone-100 rounded-xl flex items-center justify-center text-stone-500 overflow-hidden">
                        {(() => {
                          const imageUrl = getBeverageImage(bev);
                          return imageUrl ? (
                            <img src={imageUrl} alt={bev.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Beer size={18} className="md:size-5" />
                          );
                        })()}
                      </div>
                      <span className="font-bold text-stone-900 text-sm md:text-base">{bev.name}</span>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5 font-bold text-stone-900 text-sm md:text-base">Rp {bev.price.toLocaleString()}</td>
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] md:text-xs font-bold ${bev.stock < 10 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {bev.stock} Unit
                    </span>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => {
                          setSelectedBev(bev);
                          setFormData({ name: bev.name, price: bev.price, stock: bev.stock, image: bev.image || '' });
                          setShowEditModal(true);
                        }}
                        className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
                      >
                        <Edit size={18} />
                      </button>
                      <button 
                        onClick={() => setShowDeleteConfirm(bev.id)}
                        className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Tambah Minuman</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <Input label="Nama Minuman" value={formData.name} onChange={v => setFormData({...formData, name: v})} required />
              <Input label="Harga Jual" type="number" value={formData.price} onChange={v => setFormData({...formData, price: Number(v)})} required />
              <Input label="Stok Awal" type="number" value={formData.stock} onChange={v => setFormData({...formData, stock: Number(v)})} required />
              <Input label="URL Gambar (Opsional)" value={formData.image} onChange={v => setFormData({...formData, image: v})} placeholder="Contoh: /media/photos/Le Min 1500ml.png" />
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
                <button type="submit" className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg">Simpan</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Edit Minuman</h3>
            <form onSubmit={handleEdit} className="space-y-4">
              <Input label="Nama Minuman" value={formData.name} onChange={v => setFormData({...formData, name: v})} required />
              <Input label="Harga Jual" type="number" value={formData.price} onChange={v => setFormData({...formData, price: Number(v)})} required />
              <Input label="Stok" type="number" value={formData.stock} onChange={v => setFormData({...formData, stock: Number(v)})} required />
              <Input label="URL Gambar (Opsional)" value={formData.image} onChange={v => setFormData({...formData, image: v})} placeholder="Contoh: /media/photos/Le Min 1500ml.png" />
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
                <button type="submit" className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg">Perbarui</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Hapus Minuman?</h3>
            <p className="text-stone-500">Apakah Anda yakin ingin menghapus minuman ini dari inventaris? Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={() => handleDelete(showDeleteConfirm)} 
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg hover:bg-red-700 transition-all"
              >
                Hapus
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function BeveragePOS({ 
  beverages, 
  activeShift, 
  showStatus, 
  isReadOnly, 
  onRequestStartShift 
}: { 
  beverages: Beverage[], 
  activeShift: Shift | null, 
  showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void,
  isReadOnly?: boolean,
  onRequestStartShift?: () => void
}) {
  const [cart, setCart] = useState<{[id: string]: number}>({});
  const [posStatus, setPosStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [shiftSales, setShiftSales] = useState<BeverageSale[]>([]);

  useEffect(() => {
    if (!activeShift) {
      setShiftSales([]);
      return;
    }
    const q = query(
      collection(db, 'beverageSales'),
      where('shiftId', '==', activeShift.id)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BeverageSale));
      sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setShiftSales(sales);
    });
    return unsub;
  }, [activeShift]);

  const currentShiftTotalBeverageSales = shiftSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const currentShiftTotalItems = shiftSales.reduce((sum, s) => sum + s.quantity, 0);

  const filteredBeverages = beverages.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const addToCart = (id: string) => {
    if (isReadOnly) {
      setPosStatus({ type: 'error', msg: 'Anda dalam Mode Lihat Saja. Silakan masuk shift terlebih dahulu!' });
      return;
    }
    setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => {
      const next = { ...prev };
      if (next[id] > 1) next[id]--;
      else delete next[id];
      return next;
    });
  };

  const total = Object.entries(cart).reduce((acc, [id, qty]) => {
    const bev = beverages.find(b => b.id === id);
    return acc + (Number(bev?.price) || 0) * Number(qty);
  }, 0);

  const handleCheckout = async () => {
    if (isReadOnly) {
      setPosStatus({ type: 'error', msg: 'Anda dalam Mode Lihat Saja. Harap masuk shift terlebih dahulu!' });
      return;
    }
    if (!activeShift) {
      setPosStatus({ type: 'error', msg: 'Harap masuk shift terlebih dahulu!' });
      return;
    }
    
    for (const [id, qty] of Object.entries(cart)) {
      const bev = beverages.find(b => b.id === id);
      if (bev) {
        const quantity = Number(qty);
        await beverageService.recordSale({
          beverageId: id,
          beverageName: bev.name,
          quantity: quantity,
          totalAmount: Number(bev.price) * quantity,
          timestamp: new Date().toISOString(),
          shiftId: activeShift.id
        });
      }
    }
    setCart({});
    setPosStatus({ type: 'success', msg: 'Penjualan berhasil dicatat!' });
  };

  return (
    <div className="flex flex-col md:grid md:grid-cols-5 lg:grid-cols-3 gap-6 lg:gap-8">
      {posStatus && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${posStatus.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {posStatus.type === 'success' ? <CheckCircle2 size={32} /> : <AlertCircle size={32} />}
            </div>
            <h3 className="text-2xl font-bold text-stone-900">{posStatus.type === 'success' ? 'Berhasil' : 'Peringatan'}</h3>
            <p className="text-stone-500">{posStatus.msg}</p>
            <button onClick={() => setPosStatus(null)} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg">Tutup</button>
          </motion.div>
        </div>
      )}
      <div className="md:col-span-3 lg:col-span-2 space-y-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
          <input 
            type="text" 
            placeholder="Cari minuman..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 md:py-4 bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-stone-900 outline-none shadow-sm"
          />
        </div>
        
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBeverages.map(bev => (
            <motion.button
              key={bev.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => addToCart(bev.id)}
              className="bg-white p-4 md:p-6 rounded-3xl border border-stone-200 shadow-sm hover:border-stone-900 transition-all text-left group"
            >
              <div className="w-10 h-10 md:w-12 md:h-12 bg-stone-50 rounded-xl flex items-center justify-center mb-3 md:mb-4 group-hover:bg-stone-900 group-hover:text-white transition-colors overflow-hidden">
                {(() => {
                  const imageUrl = getBeverageImage(bev);
                  return imageUrl ? (
                    <img src={imageUrl} alt={bev.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Beer size={20} className="md:size-6" />
                  );
                })()}
              </div>
              <h4 className="font-bold text-stone-900 text-sm md:text-base">{bev.name}</h4>
              <p className="text-stone-500 text-xs">Stok: {bev.stock}</p>
              <p className="text-base md:text-lg font-bold text-stone-900 mt-2">Rp {bev.price.toLocaleString()}</p>
            </motion.button>
          ))}
        </div>
      </div>

      <div className="md:col-span-2 lg:col-span-1 bg-white rounded-3xl border border-stone-200 shadow-xl flex flex-col overflow-hidden h-auto md:h-[calc(100vh-250px)]">
        <div className="p-6 border-b border-stone-100 bg-stone-50">
          <h3 className="text-xl font-bold">Keranjang Belanja</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {Object.entries(cart).map(([id, qty]) => {
            const bev = beverages.find(b => b.id === id);
            return (
              <div key={id} className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-stone-900">{bev?.name}</p>
                  <p className="text-xs text-stone-500">Rp {bev?.price.toLocaleString()} x {qty}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => removeFromCart(id)} className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center hover:bg-stone-200">-</button>
                  <span className="font-bold">{qty}</span>
                  <button onClick={() => addToCart(id)} className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center hover:bg-stone-200">+</button>
                </div>
              </div>
            );
          })}
          {Object.keys(cart).length === 0 && (
            <div className="text-center py-10 text-stone-400">
              <Beer size={48} className="mx-auto mb-4 opacity-20" />
              <p>Keranjang masih kosong</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-stone-100 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-stone-500 font-medium">Total Pembayaran</span>
            <span className="text-2xl font-bold text-stone-900">Rp {total.toLocaleString()}</span>
          </div>
          <button 
            disabled={Object.keys(cart).length === 0}
            onClick={handleCheckout}
            className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            Selesaikan Penjualan
          </button>

          {/* Histori & Total Penjualan Shift Ini */}
          <div className="pt-4 border-t border-stone-100">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h4 className="font-bold text-stone-900 text-xs uppercase tracking-wider">Histori Penjualan Shift Ini</h4>
                <p className="text-[10px] text-stone-400">
                  {activeShift ? `Shift ${activeShift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'}` : 'Tidak Ada Shift'}
                </p>
              </div>
              <div className="text-right">
                <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-lg text-xs">
                  Rp {currentShiftTotalBeverageSales.toLocaleString()}
                </span>
                <p className="text-[10px] text-stone-400 mt-0.5">{currentShiftTotalItems} unit terjual</p>
              </div>
            </div>

            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {shiftSales.map((sale) => (
                <div key={sale.id} className="flex justify-between items-center p-2.5 bg-stone-50 rounded-xl border border-stone-100 text-xs">
                  <div>
                    <p className="font-bold text-stone-900">{sale.beverageName} ({sale.quantity}x)</p>
                    <p className="text-[10px] text-stone-400">{format(new Date(sale.timestamp), 'HH:mm:ss')}</p>
                  </div>
                  <p className="font-bold text-stone-900">Rp {sale.totalAmount.toLocaleString()}</p>
                </div>
              ))}
              {shiftSales.length === 0 && (
                <p className="text-center py-3 text-xs text-stone-400 italic">Belum ada transaksi di shift ini</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftManager({ activeShift, setActiveShift, user, employees, showStatus }: { activeShift: Shift | null, setActiveShift: (s: Shift | null) => void, user: FirebaseUser, employees: Employee[], showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void }) {
  const [expenses, setExpenses] = useState<OperationalExpense[]>([]);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: 0, description: '' });
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  useEffect(() => {
    if (!activeShift) return;
    const q = query(collection(db, 'expenses'), where('shiftId', '==', activeShift.id));
    return onSnapshot(q, (snap) => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalExpense)));
    });
  }, [activeShift]);

  const addExpense = async () => {
    if (!activeShift) return;
    await addDoc(collection(db, 'expenses'), {
      ...expenseForm,
      timestamp: new Date().toISOString(),
      shiftId: activeShift.id
    });
    // Update shift total
    await updateDoc(doc(db, 'shifts', activeShift.id), {
      totalOperationalExpense: increment(expenseForm.amount)
    });
    setExpenseForm({ amount: 0, description: '' });
    setShowExpenseModal(false);
  };

  const startShift = async (type: 'pagi' | 'malam') => {
    const selectedEmployees = employees.filter(e => selectedEmployeeIds.includes(e.id));
    if (selectedEmployees.length === 0) {
      // Use a local state or pass a prop to show notification
      // For now, I'll just use a simpler check in the UI
      return;
    }

    const newShift: Omit<Shift, 'id'> = {
      startTime: new Date().toISOString(),
      type,
      employeeNames: selectedEmployees.map(e => e.name),
      totalRentalIncome: 0,
      totalBeverageIncome: 0,
      totalOperationalExpense: 0,
      status: 'active'
    };
    const id = await shiftService.startShift(newShift);
    if (id) setActiveShift({ ...newShift, id });
  };

  const endShift = async () => {
    if (!activeShift) return;
    
    // Fetch totals for the shift
    const bookingsSnap = await getDocs(query(collection(db, 'bookings'), where('shiftId', '==', activeShift.id)));
    const salesSnap = await getDocs(query(collection(db, 'beverageSales'), where('shiftId', '==', activeShift.id)));
    const expensesSnap = await getDocs(query(collection(db, 'expenses'), where('shiftId', '==', activeShift.id)));

    const rentalTotal = bookingsSnap.docs.reduce((acc, d) => acc + d.data().totalAmount, 0);
    const beverageTotal = salesSnap.docs.reduce((acc, d) => acc + d.data().totalAmount, 0);
    const expenseTotal = expensesSnap.docs.reduce((acc, d) => acc + d.data().amount, 0);

    const updatedShift = {
      ...activeShift,
      totalRentalIncome: rentalTotal,
      totalBeverageIncome: beverageTotal,
      totalOperationalExpense: expenseTotal,
      status: 'closed' as const,
      endTime: new Date().toISOString()
    };

    await shiftService.closeShift(activeShift.id, updatedShift);
    
    // Generate and download report
    const report = generateShiftReport(
      updatedShift,
      bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)),
      salesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BeverageSale)),
      expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalExpense))
    );
    downloadPDF(report, `Laporan_Shift_${activeShift.type}_${format(new Date(), 'yyyyMMdd')}`);
    
    setActiveShift(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {!activeShift ? (
        <div className="bg-white p-10 rounded-3xl border border-stone-200 shadow-xl text-center space-y-8">
          <div className="w-20 h-20 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto">
            <Clock className="text-stone-400" size={40} />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-stone-900">Belum Ada Shift Aktif</h3>
            <p className="text-stone-500 mt-2">Pilih karyawan dan jenis shift untuk memulai pekerjaan hari ini.</p>
          </div>

          <div className="max-w-md mx-auto space-y-2 text-left">
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Karyawan Bertugas (Bisa pilih lebih dari satu)</label>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-4 bg-stone-50 border border-stone-200 rounded-2xl">
              {employees.filter(e => e.status === 'active').map(emp => (
                <label key={emp.id} className="flex items-center gap-3 p-2 hover:bg-stone-100 rounded-xl cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 rounded border-stone-300 text-stone-900 focus:ring-stone-900"
                    checked={selectedEmployeeIds.includes(emp.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEmployeeIds([...selectedEmployeeIds, emp.id]);
                      } else {
                        setSelectedEmployeeIds(selectedEmployeeIds.filter(id => id !== emp.id));
                      }
                    }}
                  />
                  <span className="font-bold text-stone-900">{emp.name}</span>
                </label>
              ))}
              {employees.filter(e => e.status === 'active').length === 0 && (
                <p className="text-stone-400 italic text-sm text-center py-4">Tidak ada karyawan aktif</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <button 
              onClick={() => startShift('pagi')}
              disabled={selectedEmployeeIds.length === 0}
              className="p-6 md:p-8 rounded-3xl border-2 border-amber-100 bg-amber-50 hover:bg-amber-100 transition-all group text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl flex items-center justify-center mb-3 md:mb-4 shadow-sm group-hover:scale-110 transition-transform">
                <TrendingUp className="text-amber-600" />
              </div>
              <h4 className="text-lg md:text-xl font-bold text-amber-900">Shift Pagi / Siang</h4>
              <p className="text-amber-700/60 text-xs md:text-sm mt-1">07:00 - 18:00</p>
            </button>
            <button 
              onClick={() => startShift('malam')}
              disabled={selectedEmployeeIds.length === 0}
              className="p-6 md:p-8 rounded-3xl border-2 border-indigo-100 bg-indigo-50 hover:bg-indigo-100 transition-all group text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl flex items-center justify-center mb-3 md:mb-4 shadow-sm group-hover:scale-110 transition-transform">
                <TrendingUp className="text-indigo-600" />
              </div>
              <h4 className="text-lg md:text-xl font-bold text-indigo-900">Shift Malam / Dini Hari</h4>
              <p className="text-indigo-700/60 text-xs md:text-sm mt-1">18:00 - 07:00</p>
            </button>
          </div>
          {selectedEmployeeIds.length === 0 && (
            <p className="text-center text-xs text-red-500 font-medium mt-4">Pilih minimal satu karyawan untuk memulai shift</p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-stone-900 text-white p-10 rounded-3xl shadow-2xl relative overflow-hidden">
            <div className="relative z-10 flex justify-between items-end">
              <div>
                <p className="text-stone-400 font-bold uppercase tracking-widest text-xs mb-2">Shift Berjalan</p>
                <h3 className="text-4xl font-bold tracking-tight">Shift {activeShift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'}</h3>
                <p className="text-stone-400 mt-4 flex items-center gap-2">
                  <User size={16} /> Dimulai oleh {(activeShift.employeeNames || []).join(', ')} pada {format(new Date(activeShift.startTime), 'HH:mm')}
                </p>
              </div>
              <button 
                onClick={endShift}
                className="px-8 py-4 bg-white text-stone-900 rounded-2xl font-bold hover:bg-stone-100 transition-all shadow-lg active:scale-95"
              >
                Tutup Shift & Cetak Laporan
              </button>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
              <div className="flex justify-between items-center">
                <h4 className="text-xl font-bold">Pengeluaran Operasional</h4>
                <button 
                  onClick={() => setShowExpenseModal(true)}
                  className="p-2 bg-stone-100 rounded-xl hover:bg-stone-200 transition-colors"
                >
                  <Plus size={20} />
                </button>
              </div>
              
              <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
                {expenses.map(exp => (
                  <div key={exp.id} className="flex justify-between items-center p-3 bg-stone-50 rounded-xl border border-stone-100">
                    <div>
                      <p className="font-bold text-stone-900">{exp.description}</p>
                      <p className="text-xs text-stone-500">{format(new Date(exp.timestamp), 'HH:mm')}</p>
                    </div>
                    <span className="font-bold text-red-600">- Rp {exp.amount.toLocaleString()}</span>
                  </div>
                ))}
                {expenses.length === 0 && (
                  <p className="text-stone-400 text-center py-10 italic">Belum ada pengeluaran dicatat</p>
                )}
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
              <h4 className="text-xl font-bold">Ringkasan Sementara</h4>
              <div className="space-y-4">
                <SummaryRow label="Pendapatan Sewa" value={`Rp ${activeShift.totalRentalIncome.toLocaleString()}`} />
                <SummaryRow label="Pendapatan Minuman" value={`Rp ${activeShift.totalBeverageIncome.toLocaleString()}`} />
                <SummaryRow label="Pengeluaran" value={`Rp ${activeShift.totalOperationalExpense.toLocaleString()}`} color="text-red-500" />
                <div className="pt-4 border-t border-stone-100 flex justify-between items-center">
                  <span className="font-bold text-lg">Total Setoran</span>
                  <span className="font-bold text-2xl text-stone-900">
                    Rp {(activeShift.totalRentalIncome + activeShift.totalBeverageIncome - activeShift.totalOperationalExpense).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {showExpenseModal && (
            <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6">
                <h3 className="text-2xl font-bold">Tambah Pengeluaran</h3>
                <Input label="Keterangan" value={expenseForm.description} onChange={v => setExpenseForm({...expenseForm, description: v})} />
                <Input label="Jumlah (Rp)" type="number" value={expenseForm.amount} onChange={v => setExpenseForm({...expenseForm, amount: Number(v)})} />
                <div className="flex gap-4">
                  <button onClick={() => setShowExpenseModal(false)} className="flex-1 py-3 bg-stone-100 rounded-xl font-bold">Batal</button>
                  <button onClick={addExpense} className="flex-1 py-3 bg-stone-900 text-white rounded-xl font-bold">Simpan</button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, color = 'text-stone-900' }: { label: string, value: string, color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-stone-500 font-medium">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

function HistoryReports({ shifts }: { shifts: Shift[] }) {
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [shiftDetails, setShiftDetails] = useState<{
    bookings: Booking[];
    sales: BeverageSale[];
    expenses: OperationalExpense[];
  } | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const toggleExpand = async (shiftId: string) => {
    if (expandedShiftId === shiftId) {
      setExpandedShiftId(null);
      setShiftDetails(null);
      return;
    }

    setExpandedShiftId(shiftId);
    setLoadingDetails(true);
    
    try {
      const [bookingsSnap, salesSnap, expensesSnap] = await Promise.all([
        getDocs(query(collection(db, 'bookings'), where('shiftId', '==', shiftId))),
        getDocs(query(collection(db, 'beverageSales'), where('shiftId', '==', shiftId))),
        getDocs(query(collection(db, 'expenses'), where('shiftId', '==', shiftId)))
      ]);

      setShiftDetails({
        bookings: bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Booking)),
        sales: salesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BeverageSale)),
        expenses: expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalExpense))
      });
    } catch (error) {
      console.error('Failed to fetch shift details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="bg-white p-4 md:p-10 rounded-3xl border border-stone-200 shadow-sm">
      <div className="flex items-center gap-4 mb-6 md:mb-8">
        <div className="w-10 h-10 md:w-12 md:h-12 bg-stone-100 rounded-xl flex items-center justify-center">
          <ClipboardList className="text-stone-900 size-5 md:size-6" />
        </div>
        <div>
          <h3 className="text-xl md:text-2xl font-bold text-stone-900">Histori Shift & Setoran</h3>
          <p className="text-stone-500 text-xs md:text-sm">Daftar shift yang telah ditutup dan detail transaksinya.</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 gap-4">
        {shifts.map(shift => {
          const net = shift.totalRentalIncome + shift.totalBeverageIncome - shift.totalOperationalExpense;
          const isExpanded = expandedShiftId === shift.id;

          return (
            <div key={shift.id} className="bg-stone-50 rounded-2xl border border-stone-100 overflow-hidden transition-all">
              <div 
                onClick={() => toggleExpand(shift.id)}
                className="flex flex-col md:flex-row md:items-center justify-between p-4 md:p-6 cursor-pointer hover:bg-stone-100 transition-colors"
              >
                <div className="flex items-center gap-4 md:gap-6">
                  <div className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center shadow-sm ${shift.type === 'pagi' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    <Clock size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-stone-900 text-base md:text-lg">Shift {shift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'}</p>
                      <span className="px-2 py-0.5 bg-stone-200 text-stone-600 text-[10px] font-bold rounded uppercase tracking-wider">Closed</span>
                    </div>
                    <p className="text-xs md:text-sm text-stone-500 mt-1">
                      {format(new Date(shift.startTime), 'dd MMMM yyyy')} • {(shift.employeeNames || []).join(', ')}
                    </p>
                  </div>
                </div>
                <div className="text-left md:text-right flex md:items-center gap-4 md:gap-8 mt-4 md:mt-0">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Total Setoran</p>
                    <p className="text-lg md:text-xl font-bold text-emerald-600">Rp {net.toLocaleString()}</p>
                  </div>
                  <div className="hidden md:block p-2 text-stone-400">
                    {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-stone-200 bg-white"
                  >
                    {loadingDetails ? (
                      <div className="p-12 text-center text-stone-400 flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-900 rounded-full animate-spin" />
                        <p className="text-sm font-medium">Memuat detail shift...</p>
                      </div>
                    ) : shiftDetails && (
                      <div className="p-4 md:p-8 space-y-8 md:space-y-10">
                        {/* Bookings Table */}
                        <section className="space-y-4">
                          <div className="flex items-center gap-2 text-stone-900">
                            <Bed size={20} />
                            <h4 className="font-bold">Detail Penyewaan Kamar</h4>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-stone-100">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Tamu</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Kamar</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Check In</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Check Out</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px] text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-50">
                                {shiftDetails.bookings.map(b => (
                                  <tr key={b.id} className="hover:bg-stone-50 transition-colors">
                                    <td className="p-4 font-bold text-stone-900">{b.guestName}</td>
                                    <td className="p-4 text-stone-600">{b.roomNumber}</td>
                                    <td className="p-4 text-stone-500">{format(new Date(b.checkIn), 'HH:mm')}</td>
                                    <td className="p-4 text-stone-500">{b.checkOut ? format(new Date(b.checkOut), 'HH:mm') : '-'}</td>
                                    <td className="p-4 text-right font-bold text-stone-900">Rp {b.totalAmount.toLocaleString()}</td>
                                  </tr>
                                ))}
                                {shiftDetails.bookings.length === 0 && (
                                  <tr><td colSpan={5} className="p-8 text-center text-stone-400 italic">Tidak ada penyewaan kamar</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>

                        {/* Beverage Sales Table */}
                        <section className="space-y-4">
                          <div className="flex items-center gap-2 text-stone-900">
                            <Beer size={20} />
                            <h4 className="font-bold">Penjualan Minuman</h4>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-stone-100">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Minuman</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Jumlah</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Waktu</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px] text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-50">
                                {shiftDetails.sales.map(s => (
                                  <tr key={s.id} className="hover:bg-stone-50 transition-colors">
                                    <td className="p-4 font-bold text-stone-900">{s.beverageName}</td>
                                    <td className="p-4 text-stone-600">{s.quantity} pcs</td>
                                    <td className="p-4 text-stone-500">{format(new Date(s.timestamp), 'HH:mm')}</td>
                                    <td className="p-4 text-right font-bold text-stone-900">Rp {s.totalAmount.toLocaleString()}</td>
                                  </tr>
                                ))}
                                {shiftDetails.sales.length === 0 && (
                                  <tr><td colSpan={4} className="p-8 text-center text-stone-400 italic">Tidak ada penjualan minuman</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>

                        {/* Expenses Table */}
                        <section className="space-y-4">
                          <div className="flex items-center gap-2 text-stone-900">
                            <ArrowRightLeft size={20} />
                            <h4 className="font-bold">Pengeluaran Operasional</h4>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-stone-100">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Keterangan</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px]">Waktu</th>
                                  <th className="p-4 font-bold text-stone-400 uppercase tracking-wider text-[10px] text-right">Jumlah</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-50">
                                {shiftDetails.expenses.map(e => (
                                  <tr key={e.id} className="hover:bg-stone-50 transition-colors">
                                    <td className="p-4 font-bold text-stone-900">{e.description}</td>
                                    <td className="p-4 text-stone-500">{format(new Date(e.timestamp), 'HH:mm')}</td>
                                    <td className="p-4 text-right font-bold text-red-600">Rp {e.amount.toLocaleString()}</td>
                                  </tr>
                                ))}
                                {shiftDetails.expenses.length === 0 && (
                                  <tr><td colSpan={3} className="p-8 text-center text-stone-400 italic">Tidak ada pengeluaran</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {shifts.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-stone-100">
              <FileText className="text-stone-200" size={40} />
            </div>
            <p className="text-stone-400 italic">Belum ada riwayat shift yang tersedia</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeeManagement({ employees, registrations, showStatus }: { employees: Employee[], registrations: EmployeeRegistration[], showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'requests'>('list');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
    name: '',
    phone: '',
    status: 'active',
    pin: ''
  });

  const pendingCount = registrations.filter(r => r.status === 'pending').length;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.pin.length !== 6) {
      showStatus('Peringatan', 'PIN harus 6 digit!', 'error');
      return;
    }
    await employeeService.addEmployee(formData);
    setFormData({ name: '', phone: '', status: 'active', pin: '' });
    setShowAddModal(false);
  };

  const [showApproveConfirm, setShowApproveConfirm] = useState<EmployeeRegistration | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState<EmployeeRegistration | null>(null);

  const handleApprove = async (reg: EmployeeRegistration) => {
    try {
      // 1. Add to employees
      await employeeService.addEmployee({
        name: reg.name,
        phone: reg.phone,
        pin: reg.pin,
        status: 'active'
      });
      // 2. Update registration status
      await registrationService.updateRegistrationStatus(reg.id, 'approved');
      setShowApproveConfirm(null);
    } catch (error) {
      console.error('Approval failed:', error);
      showStatus('Gagal', 'Gagal menyetujui pendaftaran. Silakan coba lagi.', 'error');
    }
  };

  const handleReject = async (reg: EmployeeRegistration) => {
    try {
      await registrationService.updateRegistrationStatus(reg.id, 'rejected');
      setShowRejectConfirm(null);
    } catch (error) {
      console.error('Rejection failed:', error);
      showStatus('Gagal', 'Gagal menolak pendaftaran. Silakan coba lagi.', 'error');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.pin.length !== 6) {
      showStatus('Peringatan', 'PIN harus 6 digit!', 'error');
      return;
    }
    if (selectedEmployee) {
      await employeeService.updateEmployee(selectedEmployee.id, formData);
      setShowEditModal(false);
      setSelectedEmployee(null);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    await employeeService.deleteEmployee(id);
    setShowDeleteConfirm(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex gap-2 md:gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          <button 
            onClick={() => setActiveSubTab('list')}
            className={`whitespace-nowrap px-4 md:px-6 py-2 rounded-xl font-bold transition-all text-sm md:text-base ${activeSubTab === 'list' ? 'bg-stone-900 text-white' : 'bg-white text-stone-400 border border-stone-200'}`}
          >
            Daftar Karyawan
          </button>
          <button 
            onClick={() => setActiveSubTab('requests')}
            className={`whitespace-nowrap px-4 md:px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 text-sm md:text-base ${activeSubTab === 'requests' ? 'bg-stone-900 text-white' : 'bg-white text-stone-400 border border-stone-200'}`}
          >
            Permintaan
            {pendingCount > 0 && <span className="w-5 h-5 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full">{pendingCount}</span>}
          </button>
        </div>
        {activeSubTab === 'list' && (
          <button 
            onClick={() => setShowAddModal(true)}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-2xl font-bold shadow-lg hover:bg-stone-800 transition-all"
          >
            <Plus size={20} /> <span className="text-sm md:text-base">Tambah Karyawan</span>
          </button>
        )}
      </div>

      {activeSubTab === 'list' ? (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px] md:min-w-full">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">Nama</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">PIN</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">No. HP</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">Status</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-stone-50 transition-colors">
                    <td className="p-4 md:p-6 font-bold text-stone-900 text-sm md:text-base">{emp.name}</td>
                    <td className="p-4 md:p-6 text-stone-600 font-mono text-xs md:text-sm">******</td>
                    <td className="p-4 md:p-6 text-stone-600 text-xs md:text-sm">{emp.phone || '-'}</td>
                    <td className="p-4 md:p-6">
                      <span className={`px-2 md:px-3 py-1 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider ${
                        emp.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="p-4 md:p-6 text-right space-x-1 md:space-x-2">
                      <button 
                        onClick={() => {
                          setSelectedEmployee(emp);
                          setFormData({ name: emp.name, phone: emp.phone, status: emp.status, pin: emp.pin });
                          setShowEditModal(true);
                        }}
                        className="p-2 text-stone-400 hover:text-stone-900 transition-colors"
                      >
                        <Edit size={18} />
                      </button>
                      <button 
                        onClick={() => setShowDeleteConfirm(emp.id)}
                        className="p-2 text-stone-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-stone-400 italic">Belum ada data karyawan</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px] md:min-w-full">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">Tanggal</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">Nama</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">No. HP</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs">Status</th>
                  <th className="p-4 md:p-6 font-bold text-stone-400 uppercase tracking-wider text-[10px] md:text-xs text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {registrations.filter(r => r.status === 'pending').map(reg => (
                  <tr key={reg.id} className="hover:bg-stone-50 transition-colors">
                    <td className="p-4 md:p-6 text-stone-500 text-[10px] md:text-xs">
                      {reg.timestamp ? format(new Date(reg.timestamp), 'dd/MM/yy HH:mm') : '-'}
                    </td>
                    <td className="p-4 md:p-6 font-bold text-stone-900 text-sm md:text-base">{reg.name}</td>
                    <td className="p-4 md:p-6 text-stone-600 text-xs md:text-sm">{reg.phone}</td>
                    <td className="p-4 md:p-6">
                      <span className="px-2 md:px-3 py-1 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700">
                        Pending
                      </span>
                    </td>
                    <td className="p-4 md:p-6 text-right space-x-1 md:space-x-2">
                      <button 
                        onClick={() => setShowApproveConfirm(reg)}
                        className="px-3 md:px-4 py-1.5 md:py-2 bg-emerald-600 text-white rounded-xl text-[10px] md:text-xs font-bold hover:bg-emerald-700 transition-all"
                      >
                        Setujui
                      </button>
                      <button 
                        onClick={() => setShowRejectConfirm(reg)}
                        className="px-3 md:px-4 py-1.5 md:py-2 bg-red-100 text-red-600 rounded-xl text-[10px] md:text-xs font-bold hover:bg-red-200 transition-all"
                      >
                        Tolak
                      </button>
                    </td>
                  </tr>
                ))}
                {registrations.filter(r => r.status === 'pending').length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-stone-400 italic">Tidak ada permintaan pendaftaran baru</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Tambah Karyawan</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <Input label="Nama Lengkap" value={formData.name} onChange={v => setFormData({...formData, name: v})} required />
              <Input label="PIN Keamanan (6 Digit)" maxLength={6} value={formData.pin} onChange={v => setFormData({...formData, pin: v})} required />
              <Input label="Nomor HP" value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Status</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value as any})}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Non-Aktif</option>
                </select>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
                <button type="submit" className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg">Simpan</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Edit Karyawan</h3>
            <form onSubmit={handleEdit} className="space-y-4">
              <Input label="Nama Lengkap" value={formData.name} onChange={v => setFormData({...formData, name: v})} required />
              <Input label="PIN Keamanan (6 Digit)" maxLength={6} value={formData.pin} onChange={v => setFormData({...formData, pin: v})} required />
              <Input label="Nomor HP" value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Status</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value as any})}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Non-Aktif</option>
                </select>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
                <button type="submit" className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg">Perbarui</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {showApproveConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Setujui Karyawan?</h3>
            <p className="text-stone-500">Apakah Anda yakin ingin menyetujui pendaftaran {showApproveConfirm.name}?</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowApproveConfirm(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={() => handleApprove(showApproveConfirm)} 
                className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg hover:bg-emerald-700 transition-all"
              >
                Setujui
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showRejectConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <XCircle size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Tolak Pendaftaran?</h3>
            <p className="text-stone-500">Apakah Anda yakin ingin menolak pendaftaran {showRejectConfirm.name}?</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowRejectConfirm(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={() => handleReject(showRejectConfirm)} 
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg hover:bg-red-700 transition-all"
              >
                Tolak
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Hapus Karyawan?</h3>
            <p className="text-stone-500">Apakah Anda yakin ingin menghapus data karyawan ini? Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={() => handleDelete(showDeleteConfirm)} 
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg hover:bg-red-700 transition-all"
              >
                Hapus
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function EmployeeRegisterForm({ onComplete, showStatus }: { onComplete: () => void, showStatus: (t: string, m: string, type?: 'success' | 'error' | 'info') => void }) {
  const [formData, setFormData] = useState<Omit<EmployeeRegistration, 'id'>>({
    name: '',
    phone: '',
    pin: '',
    status: 'pending',
    timestamp: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.pin.length !== 6) {
      showStatus('Peringatan', 'PIN harus 6 digit!', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await registrationService.addRegistration({
        ...formData,
        timestamp: new Date().toISOString()
      });
      setIsSubmitting(false);
      setIsSuccess(true);
    } catch (error) {
      console.error('Registration failed:', error);
      showStatus('Gagal', 'Pendaftaran gagal. Silakan coba lagi.', 'error');
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="text-center space-y-4 py-6">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 size={32} />
        </div>
        <h4 className="text-xl font-bold text-stone-900">Pendaftaran Berhasil!</h4>
        <p className="text-stone-500">Data Anda telah dikirim. Silakan hubungi Admin untuk menyetujui pendaftaran Anda agar bisa login.</p>
        <button 
          onClick={onComplete}
          className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
        >
          Tutup
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Nama Lengkap" value={formData.name} onChange={v => setFormData({...formData, name: v})} required />
      <Input label="Nomor HP" value={formData.phone} onChange={v => setFormData({...formData, phone: v})} required />
      <Input label="PIN Keamanan (6 Digit)" type="password" maxLength={6} value={formData.pin} onChange={v => setFormData({...formData, pin: v})} required />
      <p className="text-[10px] text-stone-400 italic">* PIN ini akan digunakan untuk login setelah disetujui Admin.</p>
      <div className="flex gap-4 pt-4">
        <button type="button" onClick={onComplete} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
        <button type="submit" disabled={isSubmitting} className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg disabled:opacity-50">
          {isSubmitting ? 'Mengirim...' : 'Daftar Sekarang'}
        </button>
      </div>
    </form>
  );
}

function RoomManagement({ rooms, roomPrices }: { rooms: Room[], roomPrices: Record<RoomType, number> }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Room | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Room | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomType, setNewRoomType] = useState<RoomType>('AC');
  const [editRoomType, setEditRoomType] = useState<RoomType>('AC');

  const [isEditingPrices, setIsEditingPrices] = useState(false);
  const [tempPrices, setTempPrices] = useState(roomPrices);

  useEffect(() => {
    setTempPrices(roomPrices);
  }, [roomPrices]);

  const handleSavePrices = async () => {
    await settingsService.updateRoomPrices(tempPrices);
    setIsEditingPrices(false);
  };

  const handleDelete = async (room: Room) => {
    if (room.status !== 'empty') {
      setErrorMsg("Hanya kamar kosong yang bisa dihapus!");
      return;
    }
    setShowDeleteConfirm(room);
  };

  const confirmDelete = async () => {
    if (showDeleteConfirm) {
      await roomService.deleteRoom(showDeleteConfirm.id);
      setShowDeleteConfirm(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-stone-900">Pengaturan Kamar</h2>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsEditingPrices(!isEditingPrices)}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-stone-200 text-stone-600 rounded-2xl font-bold hover:bg-stone-50 transition-all shadow-sm"
          >
            <Settings size={20} />
            Atur Harga
          </button>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg"
          >
            <Plus size={20} />
            Tambah Kamar
          </button>
        </div>
      </div>

      {isEditingPrices && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-100 p-8 rounded-3xl space-y-6"
        >
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-amber-900">Penyesuaian Harga Kamar</h3>
            <p className="text-sm text-amber-700">Perubahan harga akan berlaku untuk booking baru.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {(Object.keys(tempPrices) as RoomType[]).map(type => (
              <div key={type} className="space-y-1.5">
                <label className="text-xs font-bold text-amber-800 uppercase tracking-wider">{type}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-bold">Rp</span>
                  <input 
                    type="number"
                    value={tempPrices[type]}
                    onChange={e => setTempPrices({...tempPrices, [type]: Number(e.target.value)})}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold text-stone-900"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setIsEditingPrices(false)} className="px-6 py-2 text-amber-800 font-bold hover:bg-amber-100 rounded-xl transition-all">Batal</button>
            <button onClick={handleSavePrices} className="px-8 py-2 bg-amber-600 text-white rounded-xl font-bold shadow-md hover:bg-amber-700 transition-all">Simpan Harga Baru</button>
          </div>
        </motion.div>
      )}

      <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Nomor Kamar</th>
              <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Tipe</th>
              <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Harga</th>
              <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-wider text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)).map(room => (
              <tr key={room.id} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-4 font-bold text-stone-900">Kamar {room.roomNumber}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    room.type === 'AC' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                  }`}>
                    {room.type || 'Non-AC'}
                  </span>
                </td>
                <td className="px-6 py-4 font-medium text-stone-600">Rp {room.price?.toLocaleString() || (room.type === 'AC' ? '200,000' : '150,000')}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    room.status === 'empty' ? 'bg-emerald-50 text-emerald-600' : 
                    room.status === 'occupied' ? 'bg-stone-900 text-white' : 'bg-indigo-50 text-indigo-600'
                  }`}>
                    {room.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => {
                        setShowEditModal(room);
                        setEditRoomType(room.type || 'Non-AC');
                      }}
                      className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-xl transition-all"
                      title="Ubah Tipe"
                    >
                      <Settings size={20} />
                    </button>
                    <button 
                      onClick={() => handleDelete(room)}
                      className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      title="Hapus Kamar"
                    >
                      <XCircle size={20} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Tambah Kamar Baru</h3>
            <div className="space-y-4">
              <Input label="Nomor Kamar" value={newRoomNumber} onChange={setNewRoomNumber} placeholder="Contoh: 11" />
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Tipe Kamar</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={newRoomType}
                  onChange={e => setNewRoomType(e.target.value as any)}
                >
                  <option value="Non-AC">Non-AC (Rp {roomPrices['Non-AC'].toLocaleString()})</option>
                  <option value="AC">AC (Rp {roomPrices['AC'].toLocaleString()})</option>
                  <option value="VIP">VIP (Rp {roomPrices['VIP'].toLocaleString()})</option>
                  <option value="Khusus">Khusus (Rp {roomPrices['Khusus'].toLocaleString()})</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={async () => {
                  if (newRoomNumber) {
                    const price = roomPrices[newRoomType];
                    await roomService.addRoom(newRoomNumber, newRoomType, price);
                    setShowAddModal(false);
                    setNewRoomNumber('');
                  }
                }} 
                className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
              >
                Simpan
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-stone-900">Ubah Tipe Kamar #{showEditModal.roomNumber}</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Tipe Kamar</label>
                <select 
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900 outline-none"
                  value={editRoomType}
                  onChange={e => setEditRoomType(e.target.value as any)}
                >
                  <option value="Non-AC">Non-AC (Rp {roomPrices['Non-AC'].toLocaleString()})</option>
                  <option value="AC">AC (Rp {roomPrices['AC'].toLocaleString()})</option>
                  <option value="VIP">VIP (Rp {roomPrices['VIP'].toLocaleString()})</option>
                  <option value="Khusus">Khusus (Rp {roomPrices['Khusus'].toLocaleString()})</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowEditModal(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={async () => {
                  const price = roomPrices[editRoomType];
                  await roomService.updateRoomType(showEditModal.id, editRoomType, price);
                  setShowEditModal(null);
                }} 
                className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
              >
                Simpan Perubahan
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <XCircle size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Hapus Kamar?</h3>
            <p className="text-stone-500">Apakah Anda yakin ingin menghapus Kamar {showDeleteConfirm.roomNumber}? Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">Batal</button>
              <button 
                onClick={confirmDelete} 
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg hover:bg-red-700 transition-all"
              >
                Hapus
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {errorMsg && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl text-center">
            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-2xl font-bold text-stone-900">Peringatan</h3>
            <p className="text-stone-500">{errorMsg}</p>
            <button 
              onClick={() => setErrorMsg(null)} 
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold shadow-lg"
            >
              Mengerti
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
