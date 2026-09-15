#!/usr/bin/env python3
"""Generate Template Invoice .xlsx for katering ops."""
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill, numbers
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Invoice"

# --- Styles ---
bold = Font(bold=True, size=11)
bold_big = Font(bold=True, size=16)
bold_med = Font(bold=True, size=13)
align_right = Alignment(horizontal='right')
align_center = Alignment(horizontal='center')
thin_border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)
fill_header = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
font_white = Font(bold=True, color="FFFFFF", size=11)
currency_fmt = '#,##0'

# Column widths
ws.column_dimensions['A'].width = 5
ws.column_dimensions['B'].width = 30
ws.column_dimensions['C'].width = 12
ws.column_dimensions['D'].width = 18
ws.column_dimensions['E'].width = 20

# === HEADER SECTION ===
ws.merge_cells('B2:E2')
ws['B2'] = 'KATERING SEJAHTERA'
ws['B2'].font = bold_big
ws['B2'].alignment = Alignment(horizontal='center')

ws.merge_cells('B3:E3')
ws['B3'] = 'Jl. Contoh No. 123, Jakarta | Telp: 021-12345678'
ws['B3'].font = Font(size=9, italic=True)
ws['B3'].alignment = Alignment(horizontal='center')

ws.merge_cells('B5:E5')
ws['B5'] = 'INVOICE'
ws['B5'].font = bold_big
ws['B5'].alignment = Alignment(horizontal='center')

# Invoice meta
ws['B7'] = 'No. Invoice:'
ws['B7'].font = bold
ws.merge_cells('C7:E7')
# Formula: "INV-" & TEXT(D8,"YYYYMMDD") & "-" & TEXT(ROW(),"0000")
ws['C7'] = '=CONCATENATE("INV-",TEXT(D8,"YYYYMMDD"),"-",TEXT(1,"0000"))'
ws['C7'].font = bold
ws['C7'].font = Font(color="0000FF", underline="single")

ws['B8'] = 'Tanggal:'
ws['B8'].font = bold
ws['D8'] = ''
ws['D8'].number_format = 'DD/MM/YYYY'

ws['B9'] = 'Klien / Acara:'
ws['B9'].font = bold
ws.merge_cells('C9:E9')

ws['B10'] = 'Alamat Klien:'
ws['B10'].font = bold
ws.merge_cells('C10:E10')

# === ITEM TABLE ===
row = 12
ws.merge_cells(f'B{row}:E{row}')
ws[f'B{row}'] = 'Rincian Pesanan'
ws[f'B{row}'].font = bold_med
ws[f'B{row}'].alignment = Alignment(horizontal='center')

row = 13
headers = ['No', 'Nama Menu', 'Porsi', 'Harga Satuan (Rp)', 'Subtotal (Rp)']
cols = ['A', 'B', 'C', 'D', 'E']
for i, (col, hdr) in enumerate(zip(cols, headers)):
    cell = ws[f'{col}{row}']
    cell.value = hdr
    cell.font = font_white
    cell.fill = fill_header
    cell.alignment = align_center
    cell.border = thin_border

# 10 empty item rows with formulas
for idx in range(1, 11):
    r = 13 + idx
    ws[f'A{r}'] = idx
    ws[f'A{r}'].alignment = align_center
    ws[f'A{r}'].border = thin_border
    ws[f'B{r}'].border = thin_border
    ws[f'C{r}'].border = thin_border
    ws[f'C{r}'].alignment = align_center
    ws[f'D{r}'].border = thin_border
    ws[f'D{r}'].number_format = currency_fmt
    # Subtotal formula = porsi * harga satuan
    ws[f'E{r}'] = f'=IF(AND(C{r}<>"",D{r}<>""),C{r}*D{r},"")'
    ws[f'E{r}'].border = thin_border
    ws[f'E{r}'].number_format = currency_fmt

# === TOTALS ===
total_row = 24
ws.merge_cells(f'B{total_row}:D{total_row}')
ws[f'B{total_row}'] = 'Subtotal'
ws[f'B{total_row}'].font = bold
ws[f'B{total_row}'].alignment = align_right
ws[f'E{total_row}'] = f'=SUM(E14:E23)'
ws[f'E{total_row}'].number_format = currency_fmt
ws[f'E{total_row}'].font = bold
ws[f'E{total_row}'].border = Border(top=Side(style='thin'), bottom=Side(style='double'))

# PPN toggle
ppn_row = 25
ws.merge_cells(f'B{ppn_row}:C{ppn_row}')
ws[f'B{ppn_row}'] = 'PPN (%) — isi 0 atau 11:'
ws[f'B{ppn_row}'].font = bold
ws[f'D{ppn_row}'] = 11
ws[f'D{ppn_row}'].number_format = '0"%"'
ws[f'D{ppn_row}'].font = Font(color="FF0000", bold=True)
ws[f'D{ppn_row}'].alignment = align_center
ws[f'E{ppn_row}'] = f'=E{total_row}*D{ppn_row}/100'
ws[f'E{ppn_row}'].number_format = currency_fmt
ws[f'E{ppn_row}'].font = bold

grand_row = 26
ws.merge_cells(f'B{grand_row}:D{grand_row}')
ws[f'B{grand_row}'] = 'TOTAL'
ws[f'B{grand_row}'].font = Font(bold=True, size=13)
ws[f'B{grand_row}'].alignment = align_right
ws[f'E{grand_row}'] = f'=E{total_row}+E{ppn_row}'
ws[f'E{grand_row}'].number_format = currency_fmt
ws[f'E{grand_row}'].font = Font(bold=True, size=13)
ws[f'E{grand_row}'].border = Border(top=Side(style='medium'), bottom=Side(style='double'))

# === PAYMENT TERMS ===
r = 28
ws.merge_cells(f'B{r}:E{r}')
ws[f'B{r}'] = 'Syarat Pembayaran'
ws[f'B{r}'].font = bold_med

ws[f'B{r+1}'] = 'Pembayaran dalam:'
ws[f'C{r+1}'] = '14 hari kerja sejak tanggal invoice'

ws[f'B{r+2}'] = 'Metode pembayaran:'
ws[f'C{r+2}'] = 'Transfer Bank'

r2 = r + 4
ws.merge_cells(f'B{r2}:E{r2}')
ws[f'B{r2}'] = 'Informasi Rekening'
ws[f'B{r2}'].font = bold_med

ws[f'B{r2+1}'] = 'Bank:'
ws[f'C{r2+1}'] = 'BCA'
ws[f'B{r2+2}'] = 'No. Rekening:'
ws[f'C{r2+2}'] = '1234567890'
ws[f'B{r2+3}'] = 'Atas Nama:'
ws[f'C{r2+3}'] = 'PT Katering Sejahtera'

# === SIGNATURE ===
r3 = r2 + 5
ws[f'C{r3}'] = 'Hormat kami,'
ws[f'D{r3}'] = 'Penerima,'
ws[f'C{r3+4}'] = '____________________'
ws[f'D{r3+4}'] = '____________________'

# Print setup
ws.print_area = 'A1:E40'
ws.sheet_properties.pageSetUpPr = None

wb.save('D:/AI/aidit-os-v5/docs/deliverables/katering-ops/template_invoice.xlsx')
print("template_invoice.xlsx saved")