# 🏷️ CAMPUSKEY: Smart IoT RFID Attendance & Identity Management System

Master Production Platform for **ICFAI School of Science and Technology**  
*Program:* Bachelor of Computer Applications (BCA) | *Course:* Introduction to Computer System Design (ICSD)

---

## 🌟 Executive Overview

**CAMPUSKEY** is a production-grade IoT attendance and access management platform integrating embedded microcontrollers (**NodeMCU ESP8266**), 13.56 MHz RFID readers (**MFRC522**), I2C LCD character displays, and a real-time cloud **PostgreSQL backend via Supabase**, paired with a cybernetic, obsidian-themed **Admin Web Application** deployable instantly to **Vercel**.

The system operates across three distinct hardware buses:
- **SPI (Serial Peripheral Interface)** for high-speed MFRC522 RFID card polling.
- **I2C (Inter-Integrated Circuit)** on custom GPIO lines (D4 SDA / D3 SCL) for the 16×2 LCD screen.
- **Digital GPIO** driving discrete access indicators (Green LED, Red LED, and 5V Active Buzzer).

---

## 🚀 Live System Architecture

```
  ┌─────────────────────────────────────────────────────────┐
  │                 CAMPUSKEY Hardware Unit                 │
  │                                                         │
  │   [RC522 13.56MHz] ──(SPI Bus: D5,D6,D7,D8)──┐          │
  │   [16x2 I2C LCD]   ──(I2C Bus: D4 SDA, D3 SCL)┤          │
  │   [Green / Red LED]──(GPIO: D1, D2)──────────┼──ESP8266 │
  │   [5V Buzzer]      ──(GPIO: D0)──────────────┘  (NodeMCU)│
  └───────────────────────────────┬─────────────────────────┘
                                  │ HTTPS REST / RPC
                                  ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   Supabase Cloud Hub                    │
  │                                                         │
  │   • public.users (Student & Faculty profiles)           │
  │   • public.attendance_logs (Unique daily check-ins)     │
  │   • public.error_logs (Diagnostics & failed scans)      │
  │   • public.system_state (Dual-Mode state controller)    │
  │   • RPC: handle_card_scan(p_card_uid, p_device_key)     │
  └───────────────────────────────┬─────────────────────────┘
                                  │ Supabase Realtime / REST
                                  ▼
  ┌─────────────────────────────────────────────────────────┐
  │            CAMPUSKEY Admin Web Application              │
  │                                                         │
  │   • Overall Dashboard (index.html)                      │
  │   • Attendance Management & Reports (attendance.html)   │
  │   • Users & 60s Card Registration (users.html)          │
  │   • Error & Hardware Diagnostics (errors.html)          │
  └─────────────────────────────────────────────────────────┘
```

---

## 📂 Web Portal Pages & Features

| Page | URL Path | Key Features |
|---|---|---|
| **1. Admin Command Center** | [`index.html`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/index.html) | Live metric counters (Students, Faculty, Today's Check-ins, Faults), 7-day attendance trend bar chart, real-time scan activity stream, live 16×2 LCD terminal mirror, and dual-mode system banner. |
| **2. Attendance Ledger** | [`attendance.html`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/attendance.html) | Dedicated tabs for Students and Faculty, single-date and month filters, 75% attendance threshold badge alert, manual check-in adjustment, and 1-click export to CSV / Excel and official printable roster. |
| **3. Users & Card Registry** | [`users.html`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/users.html) | Directory of enrolled students and faculty, quick UID copy, profile editor (Name, Branch, Roll/Employee ID, Mobile), and **60-Second Hardware Scan Modal** that captures brand new card UIDs automatically from the NodeMCU. |
| **4. System Diagnostics** | [`errors.html`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/errors.html) | Complete audit log of failed scans (`UNREGISTERED_UID`, `DUPLICATE_SCAN`, `REG_CONFLICT`, `CARD_READ_FAIL`), remediation advice, **1-Click Card Enrollment** button directly from unassigned card records, and interactive breadboard pinout table. |

---

## ⚡ Dual-Mode Operational Logic

### Mode A: Live Attendance Mode (Default)
1. User taps card against the RC522 antenna.
2. ESP8266 sends HTTPS POST to Supabase RPC `handle_card_scan`.
3. If card UID is registered and hasn't scanned today:
   - Supabase inserts a row into `attendance_logs`.
   - NodeMCU blinks **Green LED**, sounds **1 crisp 150ms beep**, and LCD displays:
     ```
     HEY, [NAME]
     Present Marked!
     ```
4. If already scanned today:
   - Logged to `error_logs` as `DUPLICATE_SCAN`.
   - NodeMCU blinks **Red LED twice**, sounds **2 medium beeps**, and LCD displays:
     ```
     ALREADY RECORDED
     Done For Today
     ```
5. If card UID is unassigned:
   - Logged to `error_logs` as `UNREGISTERED_UID`.
   - NodeMCU lights **Red LED for 2s**, sounds **1 long warning tone (800ms)**, and LCD displays:
     ```
     USER NOT FOUND
     Unregistered ID
     ```
   - Admin can view it in the **Diagnostics page** and click **"Enroll Card"** to register it with one click!

### Mode B: 60-Second New User Registration Mode
1. Admin clicks **"New Registration (60s Hardware Scan)"** on the web dashboard.
2. Web application updates `system_state.mode = 'REGISTRATION'` with `mode_expires_at = NOW() + 60s`.
3. NodeMCU turns ON both **Green and Red LEDs** and LCD prompts:
   ```
   NEW REGISTRATION
   Scan Card Now...
   ```
4. Admin taps the new unassigned card against the NodeMCU.
5. Supabase generates a unique UUID, registers the new profile, resets system state to `ATTENDANCE`, and returns:
   ```
   CARD REGISTERED
   UID: [HEX_UID]
   ```
6. The web dashboard captures the UID in real-time, opens the profile form, and allows the admin to assign the student or faculty member's name, roll number, and department!

---

## 🔌 Hardware Circuit & Pinout Reference Matrix

| Component | Pin | NodeMCU Pin | GPIO | Function / Electrical Rule |
|---|---|---|---|---|
| **RC522 RFID** | 3.3V (VCC) | **3V3 Rail** | Power | **Strictly 3.3V** (Never connect to 5V Vin!) |
| **RC522 RFID** | RST | **3V3 Rail** | Power | Tied high to 3.3V rail to save an ESP8266 GPIO pin |
| **RC522 RFID** | GND | **GND Rail** | Ground | Common breadboard ground |
| **RC522 RFID** | MISO | **D6** | GPIO 12 | Hardware SPI Master-In Slave-Out |
| **RC522 RFID** | MOSI | **D7** | GPIO 13 | Hardware SPI Master-Out Slave-In |
| **RC522 RFID** | SCK | **D5** | GPIO 14 | Hardware SPI Serial Clock (13.56 MHz) |
| **RC522 RFID** | SDA (SS) | **D8** | GPIO 15 | Hardware SPI Chip Select |
| **16×2 LCD** | VCC | **Vin (5V)** | USB 5V | Full 5V required for crisp LCD contrast |
| **16×2 LCD** | GND | **GND Rail** | Ground | Common ground rail |
| **16×2 LCD** | SDA | **D4** | GPIO 2 | Custom I2C Data Line (Addr: `0x27`) |
| **16×2 LCD** | SCL | **D3** | GPIO 0 | Custom I2C Clock Line (Addr: `0x27`) |
| **Green LED** | Anode (+) | **D1** | GPIO 5 | In series with 220 Ω resistor (Access Granted) |
| **Red LED** | Anode (+) | **D2** | GPIO 4 | In series with 220 Ω resistor (Access Denied / Error) |
| **5V Buzzer** | Positive (+) | **D0** | GPIO 16 | Audio Notification Cues |

---

## 🚢 Deploying to Vercel (Zero-Config)

This application is built with standard HTML5, CSS3, and modern ES6 JavaScript modules with no build step required. It can be deployed directly to Vercel in seconds:

### Option 1: Via Vercel Web Dashboard (Easiest)
1. Push your repository to GitHub or GitLab.
2. Log into [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import this repository.
4. Framework Preset: Choose **"Other"**.
5. Root Directory: `./` (or leave default).
6. Click **"Deploy"**.
7. Your site is instantly live with custom HTTPS URL!

### Option 2: Via Vercel CLI
```bash
# 1. Install Vercel CLI (if not installed)
npm install -g vercel

# 2. Deploy from the project root
vercel

# 3. For production release
vercel --prod
```

The included [`vercel.json`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/vercel.json) automatically enforces clean URLs, security headers (`X-Frame-Options`, `X-Content-Type-Options`), and static caching.

---

## 💻 Running Locally

To run and preview the website on your local computer:

```bash
# Using Python built-in web server:
python -m http.server 3000

# Open in your browser:
# http://localhost:3000/
```

Or simply double-click [`index.html`](file:///c:/Users/ADMIN/Desktop/Desktop/CAMPUSKEY/index.html) to open in any web browser!

---

## 🛡️ Viva Defense & Examiner Q&A

**Q1: Why did you separate 3.3V and 5V power rails?**  
*Answer:* The MFRC522 RFID reader is CMOS 3.3V logic. Supplying 5V to its VCC will permanently burn out the RFID IC. Conversely, the 16×2 character LCD and active buzzer require a full 5V supply from the NodeMCU `Vin` pin to achieve clear contrast and audible volume.

**Q2: How did you overcome the ESP8266 GPIO pin shortage?**  
*Answer:* The NodeMCU has 9 safe usable GPIOs. Connecting the RFID (7 pins), LCD (2 pins), 2 LEDs (2 pins), and Buzzer (1 pin) normally requires 12 pins. We solved this by tying the RC522 `RST` pin directly to the 3.3V power rail, using software SPI soft-reset, and utilizing the I2C bus for the LCD display to reduce 16 parallel LCD pins down to just 2 lines (SDA/SCL).

**Q3: How does the system prevent double attendance?**  
*Answer:* The PostgreSQL backend enforces a compound `UNIQUE(user_id, scan_date)` constraint on the `attendance_logs` table. In the atomic `handle_card_scan` stored procedure, a check queries `CURRENT_DATE`. If an entry exists, the transaction returns `ALREADY_SCANNED` without marking duplicate attendance.

**Q4: How does 60-Second Card Registration work?**  
*Answer:* When the admin activates registration from the website, `system_state.mode` is set to `'REGISTRATION'` with an expiration timestamp. The NodeMCU's scan loop executes the `REGISTRATION` branch in PostgreSQL: if the card is new, it generates a unique UUID, adds the record, updates `last_registered_uid`, and returns the card UID to the web dashboard in real time.
