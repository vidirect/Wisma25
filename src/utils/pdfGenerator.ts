import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Shift, Booking, BeverageSale, OperationalExpense } from '../types';

export const generateShiftReport = (
  shift: Shift,
  bookings: Booking[] = [],
  sales: BeverageSale[] = [],
  expenses: OperationalExpense[] = []
) => {
  const doc = new jsPDF();
  const dateStr = format(new Date(shift.startTime), 'dd MMMM yyyy');
  
  // Header
  doc.setFontSize(20);
  doc.text('Laporan Shift Wisma & Beverage', 105, 15, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text(`Shift: ${shift.type === 'pagi' ? 'Pagi/Siang' : 'Malam/Dini Hari'}`, 20, 30);
  doc.text(`Karyawan: ${(shift.employeeNames || []).join(', ')}`, 20, 37);
  doc.text(`Tanggal: ${dateStr}`, 20, 44);
  doc.text(`Status: ${shift.status}`, 20, 51);

  // Financial Summary
  doc.setFontSize(14);
  doc.text('Ringkasan Keuangan', 20, 65);
  doc.setFontSize(11);
  doc.text(`Pendapatan Sewa: Rp ${shift.totalRentalIncome.toLocaleString()}`, 25, 75);
  doc.text(`Pendapatan Minuman: Rp ${shift.totalBeverageIncome.toLocaleString()}`, 25, 82);
  doc.text(`Pengeluaran Operasional: Rp ${shift.totalOperationalExpense.toLocaleString()}`, 25, 89);
  doc.setFontSize(12);
  const net = shift.totalRentalIncome + shift.totalBeverageIncome - shift.totalOperationalExpense;
  doc.text(`Total Setoran: Rp ${net.toLocaleString()}`, 25, 100);

  // Bookings Table
  if (bookings.length > 0) {
    doc.addPage();
    doc.text('Detail Penyewaan Kamar', 20, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Tamu', 'Kamar', 'Check In', 'Status', 'Total']],
      body: bookings.map(b => [
        b.guestName,
        b.roomNumber,
        format(new Date(b.checkIn), 'HH:mm'),
        b.status,
        `Rp ${b.totalAmount.toLocaleString()}`
      ]),
    });
  }

  // Beverage Sales Table
  if (sales.length > 0) {
    doc.addPage();
    doc.text('Detail Penjualan Minuman', 20, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Minuman', 'Qty', 'Total']],
      body: sales.map(s => [
        s.beverageName,
        s.quantity,
        `Rp ${s.totalAmount.toLocaleString()}`
      ]),
    });
  }

  // Expenses Table
  if (expenses.length > 0) {
    doc.addPage();
    doc.text('Detail Pengeluaran Operasional', 20, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Keterangan', 'Waktu', 'Jumlah']],
      body: expenses.map(e => [
        e.description,
        format(new Date(e.timestamp), 'HH:mm'),
        `Rp ${e.amount.toLocaleString()}`
      ]),
    });
  }

  return doc;
};

export const downloadPDF = (doc: jsPDF, filename: string) => {
  doc.save(`${filename}.pdf`);
};
