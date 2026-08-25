# =====================================================================
# gui-helper.ps1
# Backend dialog WinForms untuk menu-wgui.js — setara `kdialog` di Linux.
# Dipanggil dari Node lewat spawnSync, SATU proses per SATU dialog.
#
# Semua teks (Title/Text/Default/Items) dikirim dalam bentuk BASE64,
# bukan string mentah. Ini disengaja: kalau dikirim mentah lewat argumen
# command line, karakter kayak kutip satu ('), kutip dua ("), backtick,
# atau unicode/emoji bisa merusak parsing argumen PowerShell. Base64
# menghindari masalah itu sepenuhnya karena isinya di-decode di DALAM
# script, bukan diproses sebagai bagian dari command.
#
# Exit code: 0 = OK/Yes (user menyetujui/memilih), 1 = Cancel/No/tutup.
# Output ke stdout: hasil pilihan (Input/Menu/Checklist), dibaca oleh
# Node dari res.stdout setelah spawnSync selesai.
#
# CATATAN PERBAIKAN (revisi ke-2):
# Versi sebelumnya naruh SEMUA kontrol (label/listbox/tombol) pakai
# koordinat pixel ABSOLUT + Anchor. Ini rapuh: begitu window di-resize,
# di-maximize, atau sistemnya pakai DPI scaling (125%/150% dst — sangat
# umum di laptop Windows modern), matematika pixel manual itu berantakan
# dan tombol OK/Cancel bisa ketutupan atau nyempil ke pojok.
# FIX: seluruh layout diganti total pakai sistem DOCK (Top/Fill/Bottom)
# yang memang didesain WinForms untuk auto-reflow di ukuran window
# berapa pun — tidak ada lagi hitung pixel manual untuk POSISI kontrol.
# Ditambah DPI-awareness eksplisit supaya Windows tidak ikut nge-scale
# ulang ukuran window di luar kendali kita.
# =====================================================================

param(
    [Parameter(Mandatory=$true)][string]$Mode,
    [string]$TitleB64 = "",
    [string]$TextB64 = "",
    [string]$DefaultB64 = "",
    [string]$ItemsB64 = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── DPI AWARENESS ───────────────────────────────────────────────────
# powershell.exe secara default TIDAK dpi-aware. Tanpa ini, Windows bisa
# nge-scale ulang window/kontrol kita di belakang layar (terutama di
# laptop dengan scaling 125%/150%), yang bikin proporsi window jadi
# tidak sesuai perhitungan kita (gepeng/aneh). SetProcessDPIAware
# memaksa proses ini baca & pakai pixel FISIK, bukan pixel ter-scale.
try {
    Add-Type @"
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
    [DpiHelper]::SetProcessDPIAware() | Out-Null
} catch {}

[System.Windows.Forms.Application]::EnableVisualStyles()

function Decode-B64 {
    param([string]$b64)
    if ([string]::IsNullOrEmpty($b64)) { return "" }
    return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
}

$Title = Decode-B64 $TitleB64
$Text = Decode-B64 $TextB64
$DefaultVal = Decode-B64 $DefaultB64
$ItemsRaw = Decode-B64 $ItemsB64

# ── UKURAN WINDOW: proporsional terhadap resolusi layar AKTIF ──────────
# Rasio disamakan dengan versi Linux (menu-gui.js): ~66% lebar & ~85%
# tinggi layar. Ini HANYA menentukan ukuran/posisi window AWAL — posisi
# kontrol DI DALAM window sekarang urusan sistem Dock, bukan pixel manual.
$screenBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$winW = [int]($screenBounds.Width * (900.0 / 1366.0))
$winH = [int]($screenBounds.Height * (650.0 / 768.0))
$winX = [int](($screenBounds.Width - $winW) / 2)
$winY = [int](($screenBounds.Height - $winH) / 2)

$monoFont = New-Object System.Drawing.Font("Consolas", 10)

function New-BaseForm {
    param([int]$Width = $winW, [int]$Height = $winH, [switch]$Fixed)
    $f = New-Object System.Windows.Forms.Form
    $f.Text = $Title
    $f.Width = $Width
    $f.Height = $Height
    $f.StartPosition = "Manual"
    $f.Location = New-Object System.Drawing.Point($winX, $winY)
    if ($Fixed) {
        $f.FormBorderStyle = "FixedDialog"
        $f.MaximizeBox = $false
    } else {
        $f.FormBorderStyle = "Sizable"
        $f.MinimumSize = New-Object System.Drawing.Size(500, 380)
    }
    $f.MinimizeBox = $false
    return $f
}

# Buat panel tombol OK/Cancel yang di-Dock ke Bottom. Pakai FlowLayoutPanel
# RightToLeft supaya urutan visual selalu [OK] [Cancel] (kiri ke kanan)
# TANPA hitung koordinat X manual — lebar window berapa pun, tombol selalu
# nempel rapi di kanan-bawah.
function Add-ButtonPanel {
    param($Form, $Container, [switch]$WithCancel = $true)

    $panel = New-Object System.Windows.Forms.FlowLayoutPanel
    $panel.Dock = "Bottom"
    $panel.FlowDirection = "RightToLeft"
    $panel.Height = 46
    $panel.Padding = New-Object System.Windows.Forms.Padding(8)

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = "OK"
    $okButton.Width = 90
    $okButton.Height = 28
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $cancelButton = $null
    if ($WithCancel) {
        $cancelButton = New-Object System.Windows.Forms.Button
        $cancelButton.Text = "Cancel"
        $cancelButton.Width = 90
        $cancelButton.Height = 28
        $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    }

    # FlowDirection RightToLeft: kontrol yang ditambahkan PERTAMA muncul
    # PALING KANAN. Kita mau urutan visual [OK][Cancel] kiri->kanan,
    # jadi Cancel ditambahkan dulu (jadi paling kanan), baru OK (di kirinya).
    if ($cancelButton) { $panel.Controls.Add($cancelButton) }
    $panel.Controls.Add($okButton)

    if ($Container) {
        $Container.Controls.Add($panel)
    } else {
        $Form.Controls.Add($panel)
    }
    $Form.AcceptButton = $okButton
    if ($cancelButton) { $Form.CancelButton = $cancelButton }

    return @{ OkButton = $okButton; CancelButton = $cancelButton }
}

# Buat Label info dengan tinggi DIHITUNG EKSPLISIT dari jumlah baris teks,
# BUKAN pakai AutoSize=$true. AutoSize pada Label ber-Dock=Top ternyata
# bermasalah: tingginya dihitung berdasarkan LEBAR kontrol SEBELUM proses
# Dock benar-benar meregangkannya ke lebar penuh form (circular dependency
# lebar<->tinggi) — hasilnya tinggi yang dialokasikan jadi salah hitung,
# dan sisa ruang untuk ListBox/CheckedListBox (Dock=Fill) di bawahnya
# kegencet nyaris nol (inilah penyebab "listbox ngumpet" di revisi
# sebelumnya). Dengan tinggi dihitung manual dari jumlah baris x tinggi
# font, tidak ada lagi circular dependency — hasilnya presisi dan stabil.
function New-InfoLabel {
    param([string]$LabelText, [System.Drawing.Font]$LabelFont, [int]$PaddingV = 20)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.Font = $LabelFont
    $label.Dock = "Top"
    $label.AutoSize = $false
    $label.Padding = New-Object System.Windows.Forms.Padding(10, 10, 10, 0)

    $lineCount = ([regex]::Matches($LabelText, "`n")).Count + 1
    $label.Height = ($lineCount * $LabelFont.Height) + $PaddingV
    return $label
}

# Seluruh logika dialog dibungkus try/catch GLOBAL. Sebelumnya kalau ada
# error di tengah jalan (misal JSON items gagal di-parse), script bisa
# gagal diam-diam — kelihatan seolah dialog "berhasil" tampil tapi
# list-nya kosong, tanpa petunjuk kenapa. Sekarang exception apa pun
# langsung ditampilkan lewat MessageBox berisi pesan errornya, supaya
# gampang didiagnosis dari sisi user tanpa perlu buka terminal debug.
try {

switch ($Mode) {

    # ── MSGBOX / ERROR (dialog bawaan Windows, sudah auto-sizing benar) ──
    "MsgBox" {
        [System.Windows.Forms.MessageBox]::Show($Text, $Title, `
            [System.Windows.Forms.MessageBoxButtons]::OK, `
            [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        exit 0
    }
    "Error" {
        [System.Windows.Forms.MessageBox]::Show($Text, $Title, `
            [System.Windows.Forms.MessageBoxButtons]::OK, `
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
        exit 0
    }

    # ── YES/NO ───────────────────────────────────────────────────────
    "YesNo" {
        $r = [System.Windows.Forms.MessageBox]::Show($Text, $Title, `
            [System.Windows.Forms.MessageBoxButtons]::YesNo, `
            [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($r -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }
    }

    # ── INPUT BOX (satu baris teks) ─────────────────────────────────
    "Input" {
        $form = New-BaseForm -Height 180 -Fixed

        $buttons = Add-ButtonPanel -Form $form

        # PENTING: untuk stacking beberapa kontrol Dock=Top, urutan
        # Controls.Add() = urutan visual atas-ke-bawah. label ditambah
        # duluan (muncul paling atas), textbox ditambah setelahnya
        # (muncul di bawah label).
        $label = New-InfoLabel -LabelText $Text -LabelFont $form.Font -PaddingV 15
        $form.Controls.Add($label)

        $textbox = New-Object System.Windows.Forms.TextBox
        $textbox.Text = $DefaultVal
        $textbox.Dock = "Top"
        $textbox.Margin = New-Object System.Windows.Forms.Padding(10)
        $form.Controls.Add($textbox)

        $textbox.Select()
        $result = $form.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $textbox.Text
            exit 0
        } else {
            exit 1
        }
    }

    # ── MENU (single-select list, setara `kdialog --menu`) ──────────
    "Menu" {
        $items = $ItemsRaw | ConvertFrom-Json
        # ConvertFrom-Json balikin object tunggal (bukan array) kalau
        # cuma 1 item — paksa jadi array biar konsisten diakses via index.
        if ($items -isnot [System.Array]) { $items = @($items) }

        # DIAGNOSTIK: kalau items ternyata kosong/null setelah di-parse,
        # tampilkan isi mentah $ItemsRaw yang diterima — supaya ketahuan
        # persis apakah masalahnya di base64 decode, JSON parsing, atau
        # memang datanya kosong dari sononya (sisi Node).
        if (-not $items -or $items.Count -eq 0) {
            $preview = if ($ItemsRaw.Length -gt 300) { $ItemsRaw.Substring(0, 300) + "..." } else { $ItemsRaw }
            [System.Windows.Forms.MessageBox]::Show(
                "DEBUG: item list kosong setelah parsing.`n`nPanjang ItemsRaw: $($ItemsRaw.Length) karakter`n`nIsi (preview):`n$preview",
                "Debug - Menu items kosong", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            exit 1
        }

        $form = New-BaseForm

        # Gunakan TableLayoutPanel untuk layout utama agar area status, list,
        # dan tombol benar-benar terpisah. Ini menghindari masalah z-order
        # Dock=Fill yang sebelumnya membuat list tertutup oleh label status.
        $layout = New-Object System.Windows.Forms.TableLayoutPanel
        $layout.Dock = "Fill"
        $layout.ColumnCount = 1
        $layout.RowCount = 3
        $layout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
        $layout.Padding = New-Object System.Windows.Forms.Padding(0)

        $label = New-InfoLabel -LabelText $Text -LabelFont $monoFont
        $label.Dock = "Fill"
        [void]$layout.Controls.Add($label, 0, 0)

        $listbox = New-Object System.Windows.Forms.ListBox
        $listbox.Font = $monoFont
        $listbox.Dock = "Fill"
        $listbox.IntegralHeight = $false
        foreach ($it in $items) { [void]$listbox.Items.Add($it.label) }
        if ($listbox.Items.Count -gt 0) { $listbox.SelectedIndex = 0 }
        [void]$layout.Controls.Add($listbox, 0, 1)

        # Tombol ditempatkan sebagai row tersendiri, jadi tidak mungkin
        # menimpa/tertutup oleh ListBox.
        $buttonHost = New-Object System.Windows.Forms.Panel
        $buttonHost.Dock = "Fill"
        $buttonHost.Height = 54
        $buttons = Add-ButtonPanel -Form $form -Container $buttonHost
        [void]$layout.Controls.Add($buttonHost, 0, 2)

        [void]$form.Controls.Add($layout)

        # Double-click item = langsung pilih (setara kdialog: enter/klik dobel)
        $listbox.Add_DoubleClick({
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
        })

        $result = $form.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $listbox.SelectedIndex -ge 0) {
            Write-Output $items[$listbox.SelectedIndex].tag
            exit 0
        } else {
            exit 1
        }
    }

    # ── CHECKLIST (multi-select, setara `kdialog --checklist`) ──────
    "Checklist" {
        $items = $ItemsRaw | ConvertFrom-Json
        if ($items -isnot [System.Array]) { $items = @($items) }

        if (-not $items -or $items.Count -eq 0) {
            $preview = if ($ItemsRaw.Length -gt 300) { $ItemsRaw.Substring(0, 300) + "..." } else { $ItemsRaw }
            [System.Windows.Forms.MessageBox]::Show(
                "DEBUG: item checklist kosong setelah parsing.`n`nPanjang ItemsRaw: $($ItemsRaw.Length) karakter`n`nIsi (preview):`n$preview",
                "Debug - Checklist items kosong", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            exit 1
        }

        $form = New-BaseForm -Height 400

        # Checklist memakai layout yang sama dengan Menu: status di atas,
        # daftar di tengah, dan tombol di row bawah yang terisolasi.
        $layout = New-Object System.Windows.Forms.TableLayoutPanel
        $layout.Dock = "Fill"
        $layout.ColumnCount = 1
        $layout.RowCount = 3
        $layout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
        $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
        $layout.Padding = New-Object System.Windows.Forms.Padding(0)

        $label = New-InfoLabel -LabelText $Text -LabelFont $monoFont
        $label.Dock = "Fill"
        [void]$layout.Controls.Add($label, 0, 0)

        $checklist = New-Object System.Windows.Forms.CheckedListBox
        $checklist.Font = $monoFont
        $checklist.Dock = "Fill"
        $checklist.IntegralHeight = $false
        $checklist.CheckOnClick = $true
        foreach ($it in $items) { [void]$checklist.Items.Add($it.label, [bool]$it.checked) }
        [void]$layout.Controls.Add($checklist, 0, 1)

        $buttonHost = New-Object System.Windows.Forms.Panel
        $buttonHost.Dock = "Fill"
        $buttonHost.Height = 54
        $buttons = Add-ButtonPanel -Form $form -Container $buttonHost
        [void]$layout.Controls.Add($buttonHost, 0, 2)

        [void]$form.Controls.Add($layout)

        $result = $form.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            $selectedTags = @()
            for ($i = 0; $i -lt $items.Count; $i++) {
                if ($checklist.GetItemChecked($i)) { $selectedTags += $items[$i].tag }
            }
            Write-Output ($selectedTags -join "`n")
            exit 0
        } else {
            exit 1
        }
    }

    default {
        Write-Error "Unknown -Mode: $Mode"
        exit 1
    }
}

} catch {
    # Tangkap SEMUA exception yang lolos dari switch di atas dan
    # tampilkan detailnya (pesan + baris kode) lewat MessageBox, supaya
    # kegagalan apa pun langsung kelihatan jelas dari sisi user, bukan
    # cuma "dialog kosong tanpa penjelasan".
    $errMsg = "Terjadi error di gui-helper.ps1:`n`n$($_.Exception.Message)`n`nDi baris: $($_.InvocationInfo.ScriptLineNumber)`nMode: $Mode"
    [System.Windows.Forms.MessageBox]::Show($errMsg, "Error - gui-helper.ps1", `
        [System.Windows.Forms.MessageBoxButtons]::OK, `
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    exit 1
}