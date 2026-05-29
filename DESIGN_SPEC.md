# SMLWeb — Complete Design Specification

> เอกสารฉบับสมบูรณ์ — บอกครบว่าแต่ละหน้า / ส่วน / ปุ่ม / modal **ใช้ทำอะไร** เพื่อให้ทีม Design ออกแบบ UI ใหม่ได้ตรงตาม user goal
>
> **กลุ่มผู้ใช้:** ทีม Smart City Lab @ KMITL (ภาษาไทย, มือถือ/iPad เป็นหลัก, รองรับ Apple Pencil)
> **Stack:** Tailwind + Custom iOS-style CSS, PWA (offline-ready), Theme: Auto/Light/Dark
> **Last updated:** 2026-05-22

---

## สารบัญ

### Part A — Main App
1. [ภาพรวมระบบ — แอปนี้แก้ปัญหาอะไร](#1-ภาพรวมระบบ)
2. [Role & Permission — ทำไมต้องมี 3 ระดับ](#2-role--permission)
3. [Layout & Navigation — ลำดับแท็บมีเหตุผลอะไร](#3-layout--navigation)
4. [หน้า Login](#4-หน้า-login)
5. [หน้า Home](#5-หน้า-home)
6. [หน้า Tasks / Todo](#6-หน้า-tasks--todo)
7. [หน้า Calendar](#7-หน้า-calendar)
8. [หน้า People](#8-หน้า-people)
9. [หน้า Summary](#9-หน้า-summary)
10. [หน้า Overview (Boss-only)](#10-หน้า-overview)
11. [หน้า Profile](#11-หน้า-profile)
12. [หน้า Whiteboard](#12-หน้า-whiteboard)

### Part B — Modals & Sheets
13. [Core Generic Dialogs](#13-core-generic-dialogs)
14. [Task & Meeting Modals](#14-task--meeting-modals)
15. [Group / Member / Connection Modals](#15-group--member--connection-modals)
16. [Group-Membership Flow Modals](#16-group-membership-flow-modals)
17. [Points Workflow Modals](#17-points-workflow-modals)
18. [Polls Modals](#18-polls-modals)
19. [Admin / Management Modals](#19-admin--management-modals)
20. [Whiteboard Modals & Popovers](#20-whiteboard-modals--popovers)
21. [Inline Popovers & Floating UIs](#21-inline-popovers--floating-uis)

### Part C — Dev Tools (`/dev`)
22. [หน้า Dev — ภาพรวม](#22-หน้า-dev--ภาพรวม)
23. [Dev Panel: API Playground](#23-dev-panel-api-playground)
24. [Dev Panel: Data Explorer](#24-dev-panel-data-explorer)
25. [Dev Panel: System Info](#25-dev-panel-system-info)
26. [Dev Panel: Whiteboard](#26-dev-panel-whiteboard)
27. [Dev Panel: Component Lab](#27-dev-panel-component-lab)
28. [Dev Panel: Room Designer](#28-dev-panel-room-designer)
29. [Dev Panel: About Editor](#29-dev-panel-about-editor)
30. [Dev Panel: Files Browser](#30-dev-panel-files-browser)
31. [Dev Panel: Point Ledger](#31-dev-panel-point-ledger)
32. [Dev Panel: Activity Log](#32-dev-panel-activity-log)
33. [Dev Panel: Dev Notes](#33-dev-panel-dev-notes)
34. [Dev Panel: Settings](#34-dev-panel-settings)
35. [Dev Panel: Members](#35-dev-panel-members)
36. [Dev Page: All Modals](#36-dev-page-all-modals)

### Part D — Reference
37. [Database Schema](#37-database-schema)
38. [API Endpoints](#38-api-endpoints)
39. [Status & Enum Constants](#39-status--enum-constants)
40. [Design System](#40-design-system)
41. [Constraints — ทำไมต้องระวังเรื่องนี้](#41-constraints)
42. [Design Direction Recommendations](#42-design-direction-recommendations)

---

# Part A — Main App

## 1. ภาพรวมระบบ

### แอปนี้ทำอะไร?
SMLWeb คือเว็บแอปบริหารจัดการงานสำหรับทีม Smart City Lab @ KMITL **แก้ปัญหา 4 อย่าง:**

1. **ทีมแยกย้ายกันทำงาน ไม่รู้ใครรับผิดชอบอะไร** → ระบบ Task + Group + Assignees
2. **เก็บคะแนนความขยันยุติธรรม ไม่ใช่ใจหัวหน้าคนเดียว** → 4-phase Points workflow (เสนอเอง → leader → confirm)
3. **ติดต่อหน่วยงานภายนอกเยอะ จำไม่ไหว** → ระบบ Connection 3 ประเภท
4. **ประชุมและทำงานร่วมกัน ต้องใช้ pencil/jot** → Whiteboard collaborative + recording

### Entity หลักของระบบ

| Entity | ใช้ทำอะไร |
|---|---|
| `Member` | สมาชิกในทีม — login เข้าระบบ, ทำงาน, สะสม points |
| `Task Group` (Project) | โครงการ — รวม task หลายงาน, มี leader 1 คน ดูแล, สมาชิกหลายคน contribute |
| `Task` | งานย่อย 1 ใบ — มีคนรับผิดชอบ, มี deadline, ได้ points เมื่อเสร็จ |
| `Meeting` (kind=meeting) | นัดประชุม — ส่ง iMIP invite ทางอีเมล, มี attendees |
| `Connection` | ผู้ติดต่อภายนอก 3 ประเภท — ใช้อ้างอิงในโครงการ (บริษัท/lobbyist/หน่วยงาน) |
| `Point Request` | คำขอแก้ points หลัง confirm แล้ว — เผื่อรู้สึกไม่ยุติธรรม |
| `Deadline Request` | คำขอเลื่อน deadline — ต้องให้ admin อนุมัติ |
| `Leave` | วันลา — ระบบรู้ว่าใครไม่อยู่, แสดงในปฏิทิน |
| `Poll` | โพล/โหวต — ใช้ตัดสินใจร่วมในทีม |
| `Comment` | ความเห็นในงาน + @mention — แทน chat บางส่วน |
| `Whiteboard` | กระดานวาด collaborative — สำหรับ brainstorm + จดประชุม |
| `Recording` | ไฟล์เสียงประชุม + transcript + AI summary |
| `Category` | tag ของ task — จัดประเภท (เอกสาร / Dev / ม้าเร็ว ฯลฯ) |
| `Audit Event` | log การกระทำในระบบ — ดูย้อนหลังได้ใน /dev |

---

## 2. Role & Permission

### ทำไมต้องมี 3 ระดับ?
ทีมมีอาจารย์ (boss) + นักศึกษาที่เป็นพี่ใหญ่ (admin) + น้องเล็ก (member) — ต้องแยกสิทธิ์เพราะ:
- **Boss** เป็นเจ้าของแล็บ ดู overview ทุกอย่าง แต่ไม่ต้องลงรายละเอียดงาน
- **Admin** เป็น operator จริง สร้าง/แก้งานในทีม, อนุมัติ
- **Member** ทำงานในกลุ่ม, รับ points

### Hierarchy
```
boss (gold)   >   admin (blue)   >   member (gray)
```

> **Boss = Admin ในแง่สิทธิ์** — ต่างกันแค่ label สี + เห็น Overview แทน Summary เพราะอาจารย์ดู bird's-eye view

### ตารางสิทธิ์ — ทำอะไรได้บ้าง

| Action | Member | Admin/Boss | Group Leader | เหตุผล |
|---|:-:|:-:|:-:|---|
| ดู task ทั้งหมด | ✅ | ✅ | ✅ | ทุกคนต้องเห็นภาพรวม |
| สร้าง/แก้ task | ❌ | ✅ | ✅ (กลุ่มตัวเอง) | กัน member สร้างงานปลอม |
| ลบ task | ❌ | ✅ | ✅ (กลุ่มตัวเอง) | ป้องกันลบงานคนอื่น |
| สร้าง/แก้ group | ❌ | ✅ | ✅ (ตัวเองนำ) | leader บริหารกลุ่มตัวเองได้ |
| ลบ group | ❌ | ✅ | ❌ | leader ลบไม่ได้ — กัน accident |
| เปลี่ยน leader | ❌ | ✅ | ❌ | admin ตัดสินเรื่องโครงสร้าง |
| Confirm points | ❌ | ✅ | ✅ (กลุ่มตัวเอง) | leader รู้ว่าน้องในทีมทำมาก/น้อย |
| อนุมัติ point/deadline req | ❌ | ✅ | ❌ | admin เท่านั้น — กัน leader ลำเอียง |
| เห็นหน้า Overview | ❌ | ✅ (boss) | ❌ | bird's-eye view สำหรับอาจารย์ |
| เห็นหน้า Summary | ✅ | ✅ (admin) | ✅ | รายละเอียดโครงการสำหรับคนทำงาน |
| เห็น `/dev` | ❌ | ✅ | ❌ | debug tools ของ admin |

---

## 3. Layout & Navigation

### ทำไมต้องมี 6 แท็บ?
ทีมต้องการเข้าถึงข้อมูลหลัก 6 เรื่องในคลิกเดียว ไม่ต้องเปิด menu ซ้อน:
1. **Home** — เริ่มต้นวัน, เห็นสิ่งเร่งด่วน
2. **Overview/Summary** — มุมมองโครงการ (boss ใช้ Overview, ทีมใช้ Summary)
3. **Todo** — ทำงาน + เปลี่ยน status
4. **Calendar** — วันสำคัญ, ประชุม, deadline
5. **People** — ติดต่อทีม + connection ภายนอก
6. **Profile** — settings ตัวเอง

### Top Bar (`#topbar`) — ใช้ทำอะไร
- **ซ้าย: icon + ชื่อหน้าปัจจุบัน** — ให้ผู้ใช้รู้ว่าตัวเองอยู่หน้าไหน
- **กลาง (desktop only):** desktop nav — 6 ปุ่ม horizontal (มือถือใช้ bottom tabbar แทน)
- **ขวา:**
  - 🔔 bell — เปิด notifications sheet, มี badge นับจำนวน
  - ➕ context action — ปุ่มสร้าง entity ในหน้านั้น (เปลี่ยนตาม tab)
  - avatar — คลิกไป Profile

### Bottom Tab Bar (`#tabbar`, < 1024px)
**ใช้บนมือถือ + iPad portrait** — เพราะ 6 ปุ่มอัด topbar ไม่ได้ในจอแคบ
- Flex space-around 6 ปุ่ม + safe-area iOS

### ลำดับแท็บ — ทำไมเรียงแบบนี้

**สำหรับ Boss** — overview-focused
```
Home → Overview → Todo → Calendar → People → Profile
```

**สำหรับ Admin/Member** — task-focused
```
Home → Todo → Calendar → People → Summary → Profile
```

> Overview อยู่ position 2 (boss-only)
> Summary อยู่ position 5 (admin/member-only — boss ไม่ใช้)
> เหตุผล: boss ต้องเห็นภาพรวมเร็ว, member เริ่มจากงานของตัวเอง

---

## 4. หน้า Login

### ใช้ทำอะไร
- จุดเข้าระบบ — กรอก username + PIN เพื่อยืนยันตัวตน
- ใช้ PIN แทน password เพราะทีมเล็ก, ผู้ใช้ผูกตัวตนรู้กันอยู่แล้ว
- เป็นจุดเดียวที่ unauthenticated user เข้าถึงได้

### Visual Direction
- Fullscreen gradient indigo→blue→cyan — เป็น "welcome ambience" ก่อนเห็นข้อมูลทำงานที่จริงจัง
- Card กลาง — focal point ชัด, ไม่ต้องสะดวกตา

### Form Fields

| ID | Label | ใช้ทำอะไร |
|---|---|---|
| `#login-name` | ชื่อผู้ใช้ | username (ไม่ใช้ email เพราะทีมจำชื่อกันได้) |
| `#login-password` | รหัสผ่าน (PIN) | numeric PIN 4 หลัก — รวดเร็ว, จำง่าย |

### States
- **Default:** card สะอาด, focus ที่ name input
- **Error:** `#login-error` แสดงข้อความสีแดงใต้ form (เช่น "PIN ผิด")
- **Loading:** ปุ่มกลายเป็น "กำลังเข้าระบบ..." (disabled)

---

## 5. หน้า Home

### ใช้ทำอะไร — User Goal
**"เปิดมาเช้านี้ ฉันต้องทำอะไรก่อน?"** — Dashboard ส่วนตัวที่ตอบคำถามนี้ใน 5 วินาที

หน้านี้ตอบ 5 คำถามหลัก:
1. ฉันมีคะแนนเท่าไหร่, งานเสร็จ/ค้างกี่ใบ?
2. ทีมรวมมีสมาชิก/โครงการ/งานเสร็จ/งานเกินกำหนดกี่ใบ?
3. งานไหนใกล้ deadline ฉันต้องเร่ง?
4. ประชุมไหนใกล้จะถึง?
5. ทีมขยันแค่ไหน? (Scoreboard)

### 5.1 Greeting Banner
**ใช้ทำอะไร:** ให้ผู้ใช้รู้สึก "นี่คือพื้นที่ของฉัน" + เห็น identity + status ตัวเองทันที

- **"สวัสดี"** — friendly greeting
- **ชื่อ:** ทำให้รู้ว่า login ถูกคนแน่นอน
- **Role badge:** เตือนสิทธิ์ตัวเอง (member จะรู้ว่าเห็นเฉพาะของตัวเอง)
- **"เสร็จ X · กำลังทำ Y":** snapshot work load
- **Points ใหญ่ขวา:** เห็นสมบัติของตัวเอง — gamification

### 5.2 Stats Grid 4 ช่อง
**ใช้ทำอะไร:** สรุปสถานะทีมรวม — ตอบคำถาม "ทีมเป็นยังไง?"

| ช่อง | ใช้ทำอะไร |
|---|---|
| 👥 Members | รู้ว่าทีมมีกี่คน — ใช้ตอนวางแผน |
| 📋 Groups | จำนวนโครงการที่ active |
| ✅ Done | sense of accomplishment ของทีม |
| ⚠️ Overdue | **alert สำคัญ** — งานเกินกำหนดต้องรีบจัดการ |

### 5.3 2-Column Layout

#### คอลัมน์ซ้าย (2/3) — Action List

**(a) 📅 ใกล้ถึง Deadline**
- **ใช้ทำอะไร:** บอก member ว่า "งานไหนต้องเร่งใน 2 วัน"
- กรอง ≤ 2 วัน, ไม่รวม meetings, ไม่รวม cancelled
- Non-admin เห็นเฉพาะของตัวเอง — กันข้อมูลรก
- สีตาม urgency: 🔴 เลย / 🟠 วันนี้ / 🟡 1-2 วัน
- ปุ่ม "ดู Calendar" — เผื่ออยากเห็น big picture

**(b) 📅 การประชุมที่ใกล้จะถึง**
- **ใช้ทำอะไร:** แยก meeting จาก task เพราะลักษณะต่างกัน (meeting มีเวลาเริ่ม-จบ + สถานที่)
- Location chip สี: 🌐 Online (น้ำเงิน), 🏢 ในออฟฟิศ (เขียว), 📍 นอกสถานที่ (ส้ม)
- Online → URL link คลิกเข้า meeting ได้ทันที

**(c) 🪪 กลุ่มงานที่ยังไม่ได้เข้าร่วม**
- **ใช้ทำอะไร:** ช่วยให้ member เห็นโอกาส เข้าร่วมงานใหม่ (โครงการที่ยังขาดสมาชิก)
- เรียง leaderless ก่อน — เพราะกลุ่มไม่มี leader เสี่ยงล้ม
- Action chip ตามสถานะ:
  - **"⏳ รอพิจารณา"** = เคยเสนอตัวแล้ว รอ leader review
  - **"✋ หยิบกลุ่ม"** (admin/leader-rank) = claim เป็น leader
  - **"🙋 เสนอตัว"** (member) = ขอเข้าร่วม

#### คอลัมน์ขวา (1/3) — Awareness

**📊 Scoreboard**
- **ใช้ทำอะไร:** Gamification — ดูว่าใครขยันที่สุดเดือนนี้
- Pie chart + legend
- กรองเฉพาะคนที่มี points > 0 (กันชื่อตกค้าง)

### 5.4 🗳️ โพล / โหวต
- **ใช้ทำอะไร:** ใช้ตัดสินใจร่วมในทีม เช่น "ไปเที่ยวที่ไหน", "เลือกชุด lab", "เลื่อนประชุมไปวันไหน"
- แสดงเฉพาะ poll ที่ยัง active (max 5)
- Flags บอก behavior: 🔒 anonymous (ใครก็ไม่รู้คนโหวต), ✅ multi-choice
- ปุ่ม "+ สร้างใหม่" — ทุก role สร้างได้

### 5.5 ⏰ คำขอเลื่อน Deadline (admin/boss only)
- **ใช้ทำอะไร:** admin/boss เห็น pending requests ในหน้าแรกเลย — กันลืมอนุมัติ
- Inline approve/reject — ไม่ต้องเปิด modal เพราะข้อมูลครบในการ์ดอยู่แล้ว
- Member ไม่เห็น card นี้เพราะอนุมัติไม่ได้

---

## 6. หน้า Tasks / Todo

### ใช้ทำอะไร — User Goal
**"งานของฉัน status ไหนบ้าง? อันไหนต้องทำต่อ?"** — Kanban board สำหรับ task workflow

หน้านี้ทำให้ผู้ใช้:
1. เห็นงานของตัวเองทั้งหมด + status
2. เปลี่ยน status ด้วย drag-drop
3. ค้นหา/กรอง/sort หางานเฉพาะ
4. ไปทำ workflow ขั้นต่อไป (ส่งไฟล์, confirm points)

### 6.1 Toolbar
**ใช้ทำอะไร:** หางานเร็ว + เปลี่ยนมุมมอง

- **Search:** ค้นหาด้วยคำใดก็ได้ในชื่อ/description/group/target — รองรับตัวย่อ (เช่น "อบจ" หา "องค์การบริหารส่วนจังหวัด")
- **Filter button:** เปิด filter sheet แบบรวบยอด
- **Filter badge:** บอกว่ามีกี่ filter active (กันลืมว่า filter อยู่)

### 6.2 Segmented Control — 3 มุมมอง
**ใช้ทำอะไร:** แยก mental model ของงานเป็น 3 บริบท

| Segment | ใช้เมื่อ |
|---|---|
| **งานของฉัน** | "วันนี้ทำอะไร" — assignee view |
| **งานที่ฉันเป็นหัวหน้า** | "น้องในทีมทำอะไรอยู่" — leader view (hide ถ้าไม่ได้นำกลุ่ม) |
| **งานของ Admin** | "มีอะไรรอ approve" — admin queue view (hide ถ้าไม่ใช่ admin) |

### 6.3 Filter Sheet (slide-up)
**ใช้ทำอะไร:** หาเจอเร็ว + ปรับ scope การมอง

#### สถานะ — Multi-select chips
- **ใช้ทำอะไร:** ติ๊กได้หลายอัน เพราะบางที user อยากดู "completed + in_progress รวมกัน" หรือ "on_hold เพื่อ kick off"
- Hint "ไม่ติ๊ก = ทั้งหมด" — กัน confuse ครั้งแรก

#### เรียงตาม — 14 ตัวเลือก
**ใช้ทำอะไร:** จัดลำดับงานตาม context ที่ user สนใจ
- Deadline → เร่งงาน
- Points → เห็นงานสำคัญ
- Budget → เห็นงานมูลค่าสูง
- Group/Target → จัดกลุ่มดู

#### โครงการ / Target dropdown
- **ใช้ทำอะไร:** focus ดูเฉพาะกลุ่ม/หน่วยงานที่ต้องการ

### 6.4 Kanban Layout — 4 คอลัมน์
**ใช้ทำอะไร:** เห็น workflow ของงานเป็นภาพ — งานเดินจากซ้ายไปขวา

| คอลัมน์ | งานของฉัน | งานที่ฉันเป็นหัวหน้า | งานของ Admin |
|---|---|---|---|
| 1 | ⏸️ พักไว้ | ⏸️ พักไว้ | ⏸️ พักไว้ |
| 2 | 🔨 กำลังทำ | 🔨 กำลังทำ | 🔨 กำลังทำ |
| 3 | ✅ เสร็จ (รอ confirm) | 🟨 รอฉันคอนเฟิร์ม | 🟪 รอคอนเฟิร์ม |
| 4 | ⭐ คอนเฟิร์มแล้ว | ⭐ คอนเฟิร์มแล้ว | ⭐ คอนเฟิร์มแล้ว |

**คอลัมน์ 3 ของ Admin** เป็น **mixed queue:**
- Tasks `points_phase='final_review'` — งานเสร็จรอ admin confirm points
- Point requests — มีคนขอเพิ่ม points
- Deadline requests — มีคนขอเลื่อน deadline
- Group invitations/proposals — มีคนเสนอเข้ากลุ่ม

> **ทำไมรวมหลายอย่างใน column เดียว?** เพราะ admin มี "อนุมัติ workflow" เป็นหนึ่ง task mental — รวมจุดเดียวเห็นง่ายกว่า

**Drag-drop:** เปลี่ยน status ด้วย gesture — ไม่ต้องเปิด modal

**Grouping by project:** task รวมเป็น `<details>` ต่อกลุ่ม — เห็น progress รวมของโครงการ

**Auto-expand:** กลุ่มที่มี urgent task เปิดเองอัตโนมัติ — กันพลาด

### 6.5 Task Card
**ใช้ทำอะไร:** แสดงข้อมูลครบในการ์ดเดียว เพื่อตัดสินใจได้โดยไม่ต้องคลิก

| Element | ใช้ทำอะไร |
|---|---|
| Border-left สีกลุ่ม | บอก "งานนี้อยู่ในกลุ่มไหน" ที่ glance |
| Title + 📅 prefix (meeting) | distinguish task vs meeting |
| Status badge | บอก state ปัจจุบัน |
| Points pill | เห็นว่างานนี้มูลค่าแค่ไหน |
| Description (2-line clamp) | preview สั้นๆ — คลิกเพื่อดูเต็ม |
| Avatar stack + "ของคุณ" | รู้ใครรับผิดชอบ + ฉันอยู่ในนั้นมั้ย |
| `→ target` chip | บอกหน่วยงานปลายทาง |
| Deadline (สี urgency) | rapid priority signal |
| Phase badge | บอก step ของ points workflow |

### 6.6 Empty State
**ใช้ทำอะไร:** ตอบ "ทำไมไม่มีอะไรขึ้น?" — ป้องกัน user งง
- 🔍 icon + "ล้างคำค้น" → ถ้า filter จนไม่เจอ
- 📭 icon + "+ สร้างงานใหม่" → ถ้าไม่มีงานเลย (admin/leader)
- Hint text → "รอ assignment" (member)

### 6.7 Admin Approvals Cards
**ใช้ทำอะไร:** queue ของ admin — รวม approval ทุกประเภทในที่เดียว

| Card type | ใช้ทำอะไร |
|---|---|
| Point Request | สมาชิกขอเพิ่ม points หลัง confirm แล้ว — admin ตัดสินใจ |
| Deadline Request | สมาชิกขอเลื่อน deadline — admin อนุมัติ/ปฏิเสธ |
| Group Proposal | มีคนเสนอเข้ากลุ่ม leaderless — admin หรือ leader พิจารณา |

Inline approve/reject — ไม่ต้องเปิด modal เพราะข้อมูลครบ

### 6.8 Trash Bin (Floating 🗑)
**ใช้ทำอะไร:**
- Drop target สำหรับ drag task → ย้ายไป trash (status='cancelled')
- Gesture-based delete — เร็วกว่าเปิด context menu
- Recovery 30 วันใน Profile → ถังขยะ

---

## 7. หน้า Calendar

### ใช้ทำอะไร — User Goal
**"เดือนนี้/วันนี้มีอะไรบ้าง?"** — ปฏิทินรวม task + meeting + leave

ตอบคำถาม:
1. งานไหน meeting ไหน due วันไหน?
2. ใครลาวันนี้บ้าง?
3. ฉันมี slot ว่างวันไหน?
4. คลิกวันเฉพาะ → ดูเฉพาะวันนั้น

### 7.1 Layout — Desktop 70/30

#### ฝั่งซ้าย 70% — Calendar Grid
**ใช้ทำอะไร:** มุมมองภาพรวมเดือน — เห็น density ของงานทันที

**แต่ละ cell:**
- เลขวันที่ — primary
- Pills (max 3 ต่อประเภท) — บอก type + group color
  - 📅 meeting — สีกลุ่ม
  - 📋 task — สีกลุ่ม (สีแดงถ้า overdue)
  - 👤 leave — avatar + ชื่อ
- "+N" overflow — บอกว่ามีมากกว่านี้ คลิกดูได้
- `today` ring indigo — ระบุวันนี้
- `selected` border indigo — บอกว่าเลือกไว้
- `has-overdue` red border — alert!

**Filter logic:**
- Task แสดงเฉพาะ `in_progress` — กันรกด้วยงานเก่า
- Meetings, leaves แสดงเสมอ

#### ฝั่งขวา 30% — Detail + Action

**(a) Create Bar (sticky top)** — admin/leader only
**ใช้ทำอะไร:** สร้าง task/meeting โดย preset deadline = วันที่เลือก — ลดขั้นตอน
- Hint อธิบายว่า "เลือกวันก่อน"

**(b) Clear Selection ("‹ ดูทั้งเดือน")**
**ใช้ทำอะไร:** กลับจาก day-view → month-view โดยไม่ต้องเลือกวันใหม่
- Hidden ถ้าไม่ได้เลือกวัน — กัน UI รก

**(c) 3 Sections**

| Section | ใช้ทำอะไร |
|---|---|
| 📅 การประชุม | meetings ของวัน/เดือน — มีรายละเอียดเวลา + สถานที่ |
| 📋 งานในเดือน | tasks ที่ใกล้ deadline ในเดือน — focus งานต้องทำ |
| 🏖️ วันลา | ใครลาบ้าง — รู้ว่าคนไหนติดต่อไม่ได้ |

### 7.2 Interaction Pattern

| Action | ผลลัพธ์ | ทำไม |
|---|---|---|
| Click day cell | Filter ฝั่งขวาเป็นวันนั้น | Drill-down |
| Click วันเดิมซ้ำ | Deselect (กลับทั้งเดือน) | Toggle gesture |
| Auto-scroll today | Open เลื่อนมาที่วันนี้ | Reduce friction |
| Click pill ใน cell | เปิด task/meeting detail | Direct navigation |

---

## 8. หน้า People

### ใช้ทำอะไร — User Goal
**"ติดต่อใครยังไง?"** — รวมทุก contact: คนในทีม + ผู้ติดต่อภายนอก

แยก 2 segment เพราะ mental model ต่างกัน:
- **สมาชิก** = คนในทีม login ได้, ทำงาน, มี points
- **Connections** = คนภายนอก ไม่มี login

### 8.1 Section: สมาชิก

#### Toolbar
**ใช้ทำอะไร:** หาคนเร็ว + จัดมุมมอง

- **Search:** ชื่อ/email/phone — รองรับตัวย่อ
- **Sort:**
  - Points (default) — เห็นคนขยันก่อน
  - ชื่อ — alphabetical
  - บทบาท — boss → admin → member
  - งานมาก→น้อย — workload ranking
- **Filter:** Role — focus เฉพาะ tier

#### Member Card
**ใช้ทำอะไร:** การ์ดเดียวบอก identity + contact + workload

| Element | ใช้ทำอะไร |
|---|---|
| Avatar 48px | recognize ที่ glance |
| "(คุณ)" mark | บอก "นี่คือฉัน" |
| 🏖️ ลา badge | รู้ทันทีว่าติดต่อไม่ได้ |
| Role badge | บอกสิทธิ์ (Boss gold, Admin amber, Member slate) |
| Email tel link | แตะโทรได้เลย |
| ⭐ points · X% · tasks | summary work performance |
| ✏️ / 🗑 | จัดการ (admin/boss only) |

#### Click Card → Member Detail Sheet
**ใช้ทำอะไร:** ดูข้อมูลคนนั้น in-depth
- Avatar + email + phone — full contact
- 3 stat cards: points / done / percent
- Leave banner — แสดงสถานะตอนนี้
- Radar chart 6 axes — บอก skill profile (เอกสาร/ศิลป์/Extrovert/Participation/ม้าเร็ว/Dev)
- Task sections (in_progress/on_hold/completed) — เห็นงานคนนั้น

### 8.2 Section: Connections

#### ทำไมต้อง 3 ประเภท?
ทีมต้องติดต่อหน่วยงานหลายแบบ มี relationship ต่างกัน:

| Kind | ใช้เมื่อ | ตัวอย่าง |
|---|---|---|
| 🏢 **บริษัท** (personal) | บริษัทที่ member เป็นผู้ติดต่อหลัก | "บริษัท BS - เคน" |
| 🎯 **Lobbyist** | บุคคลคนกลาง ไม่ผูกหน่วยงาน | "พี่นัท" |
| 🏛️ **หน่วยงาน** (agency) | หน่วยงานราชการ มีคนประสานหลายคน | "อบต. → พี่ตู่ (กองช่าง), พี่แหม่ม (ปลัด)" |

#### Toolbar
**ใช้ทำอะไร:** หา + sort/filter เหมือน members
- ค้นหาครอบคลุม: company / contact_name / phone / email / notes / topics / liaison_name

#### Collapsible Sections
**ใช้ทำอะไร:** ไม่ให้รกหน้า — เปิดเฉพาะที่อยากดู
- Persisted state → กลับมาเปิดเหมือนเดิม

##### 🏢 บริษัท
- Sub-group by owning member — รู้ว่าใครเป็น contact หลัก
- Linked groups chips — เห็นว่าใช้ในโครงการไหนบ้าง

##### 🎯 Lobbyist
- Flat list — ไม่ต้อง group เพราะเป็น standalone people

##### 🏛️ หน่วยงาน
- Sub-group by company — รวม liaisons ใต้หน่วยงานเดียวกัน
- เห็นว่าหน่วยงานนี้มีใครคุยได้บ้าง

---

## 9. หน้า Summary

### ใช้ทำอะไร — User Goal
**"โครงการของฉันเป็นยังไงบ้าง?"** — มุมมอง project-centric

ต่างจาก Todo ที่ task-centric — Summary จัดข้อมูลตาม **โครงการ** ตอบคำถาม:
1. ฉันนำกลุ่มไหนบ้าง (👑)
2. ฉันอยู่ในกลุ่มไหนบ้าง (👥)
3. มีโครงการอื่นๆ ที่น่าสนใจมั้ย (🔍)
4. โครงการนี้ใกล้เสร็จยัง / มีไฟล์อะไรบ้าง?

### 9.1 Index View (รายการโครงการ)

#### "+ สร้างโครงการใหม่" (admin/leader)
**ใช้ทำอะไร:** Entry point ของ project creation

#### 3 Section หลัก
**ใช้ทำอะไร:** จัดกลุ่มตาม relationship — รู้ที่จะ focus

| Section | ใช้ทำอะไร |
|---|---|
| 👑 ที่ฉันเป็นหัวหน้า | งานที่ต้องดูแล — ลำดับความสำคัญสูง |
| 👥 ที่ฉันเป็นสมาชิก | งานที่ contribute |
| 🔍 ที่ไม่เกี่ยวข้อง | discovery — เผื่อสนใจเข้าร่วม |

#### 2 Collapsible Sections (archive)
**ใช้ทำอะไร:** เก็บไม่ให้รก แต่ยังหาได้
- 📦 archived
- ✅ completed

#### Group Card
**ใช้ทำอะไร:** snapshot โครงการ — ตัดสินใจคลิกเข้าไปดูเต็มมั้ย

| Element | ใช้ทำอะไร |
|---|---|
| Border-left สี | visual identity |
| ชื่อ + 👑 leader | รู้ผู้รับผิดชอบ |
| Description | รู้ว่าโครงการนี้เกี่ยวกับอะไร |
| 3 stats (Tasks/Points/Files) | progress at-a-glance |
| Progress bar | % เสร็จ |
| Start/Deadline | timeline |
| Connection chips | รู้ว่าทำให้หน่วยไหน |

**Bottom actions (ตาม role + state):**
- "✋ หยิบ" — claim group leaderless (admin/leader)
- "🙋 เสนอตัว" — propose join (member)
- "⏳ รอพิจารณา" — บอก state ว่า pending
- "✏️ แก้ไข" — manage
- "📦 Archive" — เก็บถ้าโครงการเสร็จ
- "🗑 ลบ" — admin

### 9.2 Detail View (เปิดโครงการเดียว)

#### Header Bar
**ใช้ทำอะไร:** navigation + bulk actions
- ‹ กลับ — back to index
- ✏️ แก้ไขโครงการ — edit metadata
- 📥 Export CSV — ดึงข้อมูลออก สำหรับรายงาน

#### Hero Section (gradient = group color)
**ใช้ทำอะไร:** เปิด context — รู้ว่ากำลังดูโครงการอะไร
- ใหญ่, มีสี — emphasize identity

#### 3 Stat Tiles
**ใช้ทำอะไร:** progress metrics ที่สำคัญ
- ✅ % เสร็จ
- ⭐ Points รวม
- 👥 สมาชิก N คน

#### Join CTA
**ใช้ทำอะไร:** entry สำหรับคนที่ยังไม่ใช่สมาชิก — ลด friction การเข้าร่วม

#### Connections Section
**ใช้ทำอะไร:** เห็นว่าโครงการนี้ทำให้ใคร
- Group by kind — รู้ประเภท connection
- Click chip → ดู connection detail

#### Members List
**ใช้ทำอะไร:** ทีมงานของโครงการนี้
- Leader row highlight gold + 👑 — เห็น hierarchy
- ปุ่ม remove — ออกจากกลุ่มได้

#### Tasks List
**ใช้ทำอะไร:** ดูงานทุกใบในโครงการ — context ของแต่ละ task ชัด
- Sub-bar เพิ่ม: ไฟล์, points, target — ข้อมูลเฉพาะหน้านี้

#### Files List
**ใช้ทำอะไร:** repository ไฟล์ของโครงการ
- Preview in-app — ไม่ต้องโหลด
- Download / Delete

#### 📄 สรุปกลุ่มอัตโนมัติ (AI summary)
**ใช้ทำอะไร:** สรุปโครงการ auto — สำหรับ report / hand-off
- Markdown rendered
- Regenerate — รีรันเมื่อข้อมูลเปลี่ยน
- Download — เก็บเป็น file

---

## 10. หน้า Overview

### ใช้ทำอะไร — User Goal (Boss only)
**"ทุกอย่างในระบบ — ฉันจัดการได้ที่ไหน?"** — Admin console รวมทุก entity

Boss ไม่ต้องเปิดหลายหน้า — เห็น tasks, groups, members, connections ในตารางเดียวพร้อม CRUD

> Member/Admin ใช้ Summary แทน เพราะ scope แคบกว่า (เฉพาะที่เกี่ยวข้อง)

### 10.1 Top Toolbar
**ใช้ทำอะไร:** ค้นหารวมทุก entity + เปลี่ยน view

- **Search:** หาทุกอย่างในที่เดียว — รวม task/group/member/connection
- **5 Tabs + counter:** บอกจำนวนเลย ทำให้รู้ scope

### 10.2 Tasks Table
**ใช้ทำอะไร:** ดูทุก task ในระบบ + edit/delete

**Columns:**
| Column | ใช้ทำอะไร |
|---|---|
| Title + group | identification |
| Status | filter target |
| Deadline | priority signal |
| Assignees | ownership |
| 💰 Budget | financial scope |
| Actions | manage |

**Multi-select filter:** ทำงาน admin task — บางที filter หลาย status พร้อมกัน

### 10.3 Groups Table
**ใช้ทำอะไร:** ดูทุกโครงการ + lifecycle management
- Archive/Unarchive — admin จัดเก็บ
- Status filter ครบ 9 lifecycle — track journey ของโครงการ

> **Boss special:** Groups tab ใช้ card view (renderSummaryIndex) แทน table — เพราะอาจารย์อาจชอบดูเป็น visual cards

### 10.4 Members Table
**ใช้ทำอะไร:** จัดการ member + role assignment
- Role badge สีต่างกัน — boss gold-ring, admin amber, member slate
- Group membership filter — เห็น "ใครอยู่ในกลุ่มไหน"

### 10.5 Connections Table
**ใช้ทำอะไร:** จัดการ contact ภายนอก
- "โดย: member_name" — สำหรับ personal (รู้ว่า contact ของใคร)

### 10.6 Multi-select Filter Popover
**ใช้ทำอะไร:** เลือกหลายค่าพร้อมกัน (ต่างจาก dropdown ที่เลือกได้อันเดียว)
- Checkbox list
- Count badge บนปุ่ม — บอกว่า filter อยู่กี่อัน

---

## 11. หน้า Profile

### ใช้ทำอะไร — User Goal
**"ตั้งค่าตัวฉัน"** — ที่เดียวสำหรับ identity + settings + tools

### 11.1 Avatar Card
**ใช้ทำอะไร:** identity hero — เห็นตัวเองชัด
- Avatar ใหญ่ + 📷 edit — เปลี่ยนรูปได้ทันที
- Role badge — เตือนสิทธิ์ตัวเอง
- "ลบรูปโปรไฟล์" — กรณีไม่อยากใช้รูป

### 11.2 Stats List
**ใช้ทำอะไร:** snapshot performance ตัวเอง
- ⭐ points — gamification
- ✅ done / ⏳ doing / 📋 all — workload

### 11.3 Theme Toggle
**ใช้ทำอะไร:** ปรับให้ใช้สบายตา
- 💻 Auto — ตาม OS (default)
- ☀️ Light — fixed
- 🌙 Dark — fixed (ใช้กลางคืน)

### 11.4 Settings List
**ใช้ทำอะไร:** Entry points ของ functions ต่างๆ

| Row | ใช้ทำอะไร | ใคร |
|---|---|---|
| 🔑 เปลี่ยน PIN | security — เปลี่ยน password ตัวเอง | ทุกคน |
| 🏖️ จัดการวันลา | บอกระบบว่าจะลา → ขึ้นปฏิทินทีม | ทุกคน |
| 📁 จัดการ Task Groups | bulk manage โครงการตัวเองเป็นเจ้าของ | admin/leader |
| ⏰ คำขอเลื่อน Deadline | ดู requests ที่ส่งไป + status | ทุกคน |
| 🗑️ ถังขยะ | กู้คืน task/group ที่ลบ (30 วัน) | ทุกคน |
| ⚙️ ตั้งค่าระบบ | SMTP, email toggle, etc. | admin |
| 🛠️ Dev & Test Tools | เข้า /dev | admin |
| 🚪 ออกจากระบบ | logout — สีแดงเพื่อเตือน | ทุกคน |

---

## 12. หน้า Whiteboard

### ใช้ทำอะไร — User Goal
**"เขียน/วาดร่วมกัน — brainstorm หรือจดประชุม"** — Collaborative canvas + Apple Pencil ready

### 12.1 List View
**ใช้ทำอะไร:** เลือก board ที่จะเข้า
- "+ สร้างใหม่" — สร้าง board เปล่า

### 12.2 Canvas View (Fullscreen)
**ใช้ทำอะไร:** วาดเต็มจอ — เสมือนกระดาษจริง

#### Tool Groups (เหตุผลการแบ่ง)

| Group | ใช้ทำอะไร |
|---|---|
| **Navigate** (select/lasso/pan) | จัดการ object — เลือก, ขีดวง, เลื่อนหน้า |
| **Draw** (draw/highlight/eraser) | วาดอิสระ — เลียนแบบปากกา/highlighter/ยางลบ |
| **Shape** (line/arrow/rect/circle/triangle/diamond) | flowchart / mind map |
| **Insert** (text/sticky/image) | เพิ่ม content ไม่ใช่วาด |
| **Style** (color/stroke/fill) | กำหนดลักษณะ |
| **History** (undo/redo) | กู้ได้ — กล้าทดลอง |
| **Zoom** | ดูใกล้/ไกล + fit screen |
| **Paper** | ตั้ง grid/dot/lined — เหมือนสมุดต่างแบบ |
| **Action** (fullscreen/inject/record/export/delete) | functional |

**ทำไมมี recorder?** — จดประชุมพร้อม record เสียง → ภายหลังกลับมาฟัง + AI transcribe

**ทำไมมี inject?** — ดึง task/meeting/points จากระบบมา paste บน canvas เพื่อ refer ตอน brainstorm

#### Auto-save 1.5 วินาที
**ใช้ทำอะไร:** กันลืม save — ไม่มีปุ่ม save manual

#### Multi-user Cursor
**ใช้ทำอะไร:** เห็น collaborator ทำอะไร real-time

#### Floating Recorder Widget
**ใช้ทำอะไร:** ไม่บล็อก canvas — record ไป วาดไป

---

# Part B — Modals & Sheets

## 13. Core Generic Dialogs

### 13.1 `openModal()` — Generic Form Modal
**ใช้ทำอะไร:** infrastructure ของ form-style modal ทั้งหมด (รียูส code)
- Slide-up mobile, centered desktop
- Backdrop click + Esc + Tab cycling + Focus trap — UX defaults
- Body scroll lock — กัน scroll หน้าด้านหลัง
- flatpickr auto — date inputs สม่ำเสมอ

### 13.2 `uiConfirm()` — Yes/No Dialog
**ใช้ทำอะไร:** แทน native `confirm()` ที่ดูเก่าและไม่ตรง brand
- 2-column buttons (ยกเลิก / ยืนยัน)
- Danger mode → ปุ่มแดง (delete actions)
- Promise-based — async-friendly

### 13.3 `uiPrompt()` — Text Input Dialog
**ใช้ทำอะไร:** แทน native `prompt()` — ขอข้อความสั้นๆ
- Use cases: เพิ่ม category, rename, comment label

### 13.4 `openSheet()` — Right/Bottom Sheet
**ใช้ทำอะไร:** infrastructure สำหรับ task detail / member detail — ที่เนื้อหายาว

### 13.5 Toast
**ใช้ทำอะไร:** feedback ที่ไม่ block — "บันทึกแล้ว", "ผิดพลาด"
- Auto-dismiss
- Non-interactive

---

## 14. Task & Meeting Modals

### 14.1 `openTaskModal()` — สร้าง/แก้ Task
**ใช้เมื่อ:** admin/leader คลิก "+ งาน" หรือ "✏️ แก้ไข"

| Field | ใช้ทำอะไร |
|---|---|
| `title` | identification — required |
| `description` (Markdown) | รายละเอียดงาน |
| `group_id` | ผูกกับโครงการ |
| `+ สร้างกลุ่มใหม่` | shortcut — กรณีต้องการ group ใหม่ตอนสร้าง task |
| `target` | หน่วยงานปลายทาง (ถ้าไม่มี group) |
| `deadline` | กำหนดส่ง |
| `budget` (k/m/b) | งบ — รับ shorthand เพื่อเร็ว |
| Categories chips | tag — search/filter ได้ |
| Assignees | ใครรับผิดชอบ |
| `status` | initial state |

### 14.2 `openTaskEdit()` — แก้ Task + Manage
**ใช้เมื่อ:** จาก task sheet กดปุ่ม ✏️
**ต่างจาก create:** เพิ่ม 3 management buttons
- ⭐ แบ่ง Points — เปิด allocate modal
- 👥 จัดการผู้รับผิดชอบ — assign/unassign
- ⏰ ขอเลื่อน Deadline — สำหรับ assignee ที่ต้องขอ

### 14.3 `openMeetingModal()` — สร้างประชุม
**ใช้เมื่อ:** สร้าง meeting (kind='meeting')
**ต่างจาก task:** มี location_type + end_time + ส่ง iMIP email

**Location radio (3 tiles):**
- 🌐 Online — กรอก URL → ขึ้นเป็น link
- 🏢 onsite_internal "Lab @ECC-504" — preset
- 📍 onsite_external — กรอก address

### 14.4 `openTaskSheet()` — Task Detail
**ใช้เมื่อ:** คลิก task card
**ใช้ทำอะไร:** ดูรายละเอียด + ทำ action

| Element | ใช้ทำอะไร |
|---|---|
| Status + phase badges | บอก state ปัจจุบัน |
| Group + target chips | context |
| Location card (meeting) | สำหรับ meeting เท่านั้น |
| Date cards | timing |
| Assignees list | ผู้รับผิดชอบ + points_share |
| 📎 ส่งงาน | เปิด submission sheet — upload ไฟล์ |
| ⭐ Points workflow button | label เปลี่ยนตาม phase |
| 📧 ส่งเชิญอีเมล | re-send iMIP (meeting) |
| ✏️ แก้ไข / 🗑 ลบ | management |
| Comments + @mention | discussion |

### 14.5 `openSubmissionSheet()` — Upload Files
**ใช้เมื่อ:** assignee ส่งงาน
**ใช้ทำอะไร:**
- Drop zone — drag files หรือเลือก
- Per-file doc_type — ระบุประเภทเอกสาร (เพื่อแยกใน archive)
- URL link — บางทีไม่มี file แต่มี link เช่น Google Doc
- Submitted files list — เห็นว่าส่งอะไรไปแล้ว

**Auto-complete:** ส่งไฟล์แรก → task → completed + prompt own points → ลด step

### 14.6 `openDocTypePicker()` — Doc Type Picker
**ใช้เมื่อ:** กดเลือก doc_type ในการ upload
**ใช้ทำอะไร:** เลือกประเภทเอกสารจาก list ที่ admin ตั้งไว้ (เช่น "TOR", "Quotation", "MoU", "อื่นๆ")

### 14.7 `openCreateTaskFlow()` — Task Creation Router
**ใช้เมื่อ:** กด "+ งาน"
**ใช้ทำอะไร:** ถามก่อนว่าจะสร้างใน group ไหน — ลดความผิดพลาดเรื่อง group ผูกผิด

### 14.8 `openMultiTaskModal()` — Batch Task Create
**ใช้เมื่อ:** ต้องสร้างหลาย task ในกลุ่มเดียวกัน
**ใช้ทำอะไร:** ประหยัดเวลา — ไม่ต้องเปิด modal ทีละใบ
- "+ เพิ่มอีก" — add row
- ทุก row mini-form (title/deadline/budget/cat/assignees)

---

## 15. Group / Member / Connection Modals

### 15.1 `openGroupModal()` — สร้าง/แก้ Group
**ใช้เมื่อ:** admin/leader สร้างหรือแก้โครงการ

| Field | ใช้ทำอะไร |
|---|---|
| `name` | identification |
| `description` | รายละเอียดโครงการ |
| `target` | หน่วยงานหลักของโครงการ |
| **Color picker** | identity color — ใช้ตลอด app (border-left, hero) |
| `leader_id` | กำหนดหัวหน้า (admin only) |
| Members chips | สมาชิกเริ่มต้น |
| Connection picker | ผูกกับ contact ภายนอก |
| `status` | lifecycle stage |

#### Color Picker (composite) — ทำไมต้องซับซ้อน?
- **3 ตัวเลือกร่วม:** native + hex + preset palette
- เพราะ user หลายคนชอบต่างกัน — บางคน type hex, บางคนใช้ palette
- **3-tier:** light/medium/bold — บังคับ user เลือกสีที่อ่านง่าย ไม่ใช่ random color
- **Used flag:** เตือนถ้าสีซ้ำกับกลุ่มอื่น — ป้องกัน confusion

### 15.2 `openMemberModal()` — สร้าง/แก้ Member (admin only)
**ใช้เมื่อ:** admin เพิ่มคนใหม่ในระบบ
**Note:** ไม่มี self-signup — admin ต้องสร้าง member ก่อน

### 15.3 `openConnectionModal()` — สร้าง/แก้ Connection
**ใช้เมื่อ:** เพิ่ม contact ภายนอกใหม่

**Kind radio (3 tiles):** dynamic fields ตามประเภท — กัน confusion (บริษัทไม่ต้องการ liaison_name)

### 15.4 `openMemberDetail()` — Member Profile Sheet
**ใช้เมื่อ:** คลิก member card
**ใช้ทำอะไร:** ดูข้อมูล + skill profile + งาน

**Radar chart 6 axes:**
- เอกสาร, ศิลป์, Extrovert, Participation, ม้าเร็ว, Dev
- คำนวณจาก category prefix matches + meeting attendance
- ใช้ตอน assign งาน — รู้ว่าคนนี้เหมาะกับงานแบบไหน

---

## 16. Group-Membership Flow Modals

### 16.1 `openAssignTaskModal()`
**ใช้เมื่อ:** เพิ่ม assignee คนเดียวให้ task ที่มีอยู่
**ใช้ทำอะไร:** quick action — ไม่ต้องเปิด task edit form ใหญ่

### 16.2 `openInviteToGroupModal()`
**ใช้เมื่อ:** leader/admin เชิญสมาชิกเข้ากลุ่ม
**ใช้ทำอะไร:** bulk invite — multi-select chips
- หลายๆคนพร้อมกัน — ไม่ต้องเรียก API ทีละคน

### 16.3 `openProposeGroupModal()`
**ใช้เมื่อ:** member เสนอตัวเข้ากลุ่ม leaderless
**ใช้ทำอะไร:** บอกเหตุผลให้ leader พิจารณา
- Optional message — เพิ่ม context

---

## 17. Points Workflow Modals

### 17.1 `promptOwnPointsIfNeeded()` — Quick Self-Propose
**ใช้เมื่อ:** task เพิ่ง completed (ส่งไฟล์แรก)
**ใช้ทำอะไร:** prompt member ใส่ points ตัวเองทันที — ลดขั้นตอนเปิด modal

### 17.2 `openAllocateModal()` — Points Workflow Main
**ใช้เมื่อ:** จัดการ points ของ task
**ใช้ทำอะไร:** ดู phase ปัจจุบัน + ทำ action ของ phase นั้น

**4 Phases — เหตุผล:**

| Phase | ใช้เมื่อ | ทำไม |
|---|---|---|
| 🟦 proposing | task เสร็จใหม่ๆ | สมาชิกประเมินตัวเองก่อน — ลด bias |
| 🟨 leader_review | leader เปิดดูเสนอ | leader ปรับให้แฟร์ |
| 🟪 final_review | leader approve แล้ว | admin ทบทวนรอบสุดท้าย |
| ✅ confirmed | จบ — points แจกแล้ว | locked |

**Reopen button (confirmed phase):** กรณีพบความผิดพลาดทีหลัง — admin/leader เปิด edit ใหม่ได้

**Points request (confirmed phase):** ช่อง appeal — member รู้สึกไม่ยุติธรรม → ขอเพิ่มได้

### 17.3 `openRequestExtensionModal()` — ขอเลื่อน Deadline
**ใช้เมื่อ:** assignee/leader พบว่าทำไม่ทัน
**ใช้ทำอะไร:** ส่ง request ให้ admin อนุมัติ
- ต้องระบุเหตุผล — กันขอเลื่อนพร่ำเพรื่อ

---

## 18. Polls Modals

### 18.1 `openPollModal()` — โหวต/ดูผล
**ใช้เมื่อ:** คลิก poll card
**ใช้ทำอะไร:**
- โหวต (ครั้งแรก)
- เปลี่ยนคำตอบ (ครั้งถัดไป)
- ดู result bar — visual ของ % vote
- ปิด/ลบ poll (creator/admin)

### 18.2 `openCreatePollModal()` — สร้าง Poll ใหม่
**ใช้เมื่อ:** กด "+ สร้างใหม่" ในหน้า Home
**Fields:**
- คำถาม
- ตัวเลือก (+ เพิ่มได้)
- 🔒 anonymous — ใครก็ไม่รู้ใครโหวต
- ✅ multi-choice — ติ๊กได้หลายข้อ
- expires_at — auto-close

---

## 19. Admin / Management Modals

### 19.1 `openExtensionsModal()` — Deadline Requests List
**ใช้เมื่อ:** admin คลิก ⏰ ใน Profile
**ใช้ทำอะไร:** queue ของ requests รอ approve
- Inline approve/reject ใน card

### 19.2 `openMyLeavesModal()` — จัดการวันลาตัวเอง
**ใช้เมื่อ:** คลิก 🏖️ ใน Profile
**ใช้ทำอะไร:**
- ดูประวัติลา
- เพิ่มวันลาใหม่ → จะขึ้นในปฏิทินทีม

### 19.3 `openGroupListModal()` — Group Manager
**ใช้เมื่อ:** admin/leader คลิก 📁 ใน Profile
**ใช้ทำอะไร:** จัดการ group bulk — card per group
- Progress bar — เห็นสถานะรวม
- Edit / Delete actions

### 19.4 `openTrashModal()` — ถังขยะ
**ใช้เมื่อ:** คลิก 🗑️ ใน Profile
**ใช้ทำอะไร:** กู้คืน task/group/meeting ที่ลบ (30 วัน)
- **3 sections** (โครงการ/งาน/ประชุม) — แยกประเภทให้ scan ง่าย
- Per-card: ↩ คืน / 🗑️ ลบถาวร (admin)

### 19.5 `openSystemSettingsModal()` — ตั้งค่าระบบ
**ใช้เมื่อ:** admin คลิก ⚙️
**ใช้ทำอะไร:**
- SMTP status — รู้ว่าระบบส่งอีเมลได้ไหม
- Toggle: เปิด/ปิด email invitations อัตโนมัติ

### 19.6 Change PIN Modal
**ใช้เมื่อ:** คลิก 🔑
**ใช้ทำอะไร:** security — ต้องกรอก current_password ก่อนตั้งใหม่

### 19.7 `openNotifications()` — Bell Sheet
**ใช้เมื่อ:** คลิก 🔔
**ใช้ทำอะไร:** รวมทุก event ที่ต้องสนใจในที่เดียว

**Sources (10 ประเภท):**
| Source | เหตุผล |
|---|---|
| ⚠️ Overdue tasks ของฉัน | priority สูงสุด |
| ⏰ Due today/≤3 days | upcoming alert |
| 🪪 Open unassigned tasks ในกลุ่มฉันนำ | leader action |
| ⏰ Pending extension requests | admin queue |
| 💎 Pending point requests | admin queue |
| ✅/❌ Decided requests for me | result feedback |
| 📩 Pending group invitations to me | join opportunity |
| 📩 Pending proposals to my groups | leader review |
| ✅/❌ Outgoing invites decided | result feedback |
| 💬 @mentions in comments | direct attention |

**Sort newest-first** — recency relevance
**Inline approve/reject** — เร็ว ไม่ต้องเปิด modal

### 19.8 `openPreview()` — File Preview Sheet
**ใช้เมื่อ:** คลิกไฟล์
**ใช้ทำอะไร:** ดูไฟล์ใน-app — ไม่ต้องโหลด

**Per type:**
| Type | Render |
|---|---|
| Image | `<img>` |
| PDF | `<iframe>` |
| Video/Audio | native player |
| Text | `<pre>` |
| DOCX | docx-preview lib |
| XLSX | sheet tabs |
| PPTX | download fallback |

**Download button** — bypass preview ถ้าอยากเปิดเอง

---

## 20. Whiteboard Modals & Popovers

### 20.1 Inject Modal
**ใช้เมื่อ:** คลิก 📥
**ใช้ทำอะไร:** ดึงข้อมูลในระบบมา paste บน canvas
- 4 tabs (task/group/meeting/points) — pick by type
- Search — หาเร็ว
- "+ สร้างใหม่" — สร้างของใหม่ใส่ทันที

**Points tab พิเศษ:** admin อนุมัติ/ปฏิเสธ point request ในนี้ได้ + inject "point_decision" card

### 20.2 Paper Size Popover
**ใช้เมื่อ:** คลิก 📐
**ใช้ทำอะไร:** เปลี่ยนขนาดกระดาษ
- A4/A3/A5/Letter/Tabloid + ∞ (infinite canvas)
- ใช้ตอน export PNG → ขนาดกระดาษจริง

### 20.3 Color Picker (inline)
**ใช้ทำอะไร:** เลือกสีปากกา
- 8 quick swatches — สีที่ใช้บ่อย
- Recent colors (LRU 6) — สีที่เพิ่งใช้
- Custom picker — ฟรีสไตล์

### 20.4 New Board Prompt (native)
**ใช้เมื่อ:** คลิก "+ สร้างใหม่"
**ใช้ทำอะไร:** ขอชื่อ board

> ใช้ native `prompt()` ไม่ใช่ `uiPrompt` — inconsistent (technical debt)

### 20.5 Floating Recorder Widget
**ใช้เมื่อ:** เริ่ม record (กด 🎙)
**ใช้ทำอะไร:** record audio ขณะวาด canvas — ไม่บล็อกการทำงาน

---

## 21. Inline Popovers & Floating UIs

### 21.1 @Mention Autocomplete
**ใช้เมื่อ:** type `@` ใน comment textarea
**ใช้ทำอะไร:** เลือกชื่อ member จาก list
- Arrow keys + Enter
- Member ที่ tag จะได้ notification

### 21.2 Overview Filter Popover
**ใช้เมื่อ:** คลิก filter button
**ใช้ทำอะไร:** multi-select filter (ต่างจาก dropdown ที่เลือกอันเดียว)

### 21.3 Filter Sheet (Tasks)
**ใช้เมื่อ:** คลิก filter button หน้า Todo
**ใช้ทำอะไร:** Filter ทุกอย่างใน sheet เดียว — sticky header กัน scroll หาย

### 21.4 Avatar Upload Flow
**ใช้เมื่อ:** คลิก 📷 ใน Profile
**ใช้ทำอะไร:**
- เปิด file picker
- Resize เป็น 384px WebP (~85%) — ลดขนาดอัปโหลด
- Upload → preview ทันที

### 21.5 Trash Bin (Floating)
**ใช้เมื่อ:** drag task card บนหน้า Todo
**ใช้ทำอะไร:** drop zone — เร็วกว่ากด menu → ลบ

### 21.6 Category Manager (inline)
**ใช้เมื่อ:** ใน task form
**ใช้ทำอะไร:** เพิ่ม/ลบ/แก้ category ในที่เดียวกับ form — ไม่ต้องเปิดหน้า settings แยก

---

# Part C — Dev Tools (`/dev`)

## 22. หน้า Dev — ภาพรวม

### ใช้ทำอะไร — User Goal
**"Debug, monitor, admin tools — ทุกอย่างที่ user ปกติไม่ต้องเห็น"**

`/dev` คือ admin/dev console — รวม tools ที่ใช้:
- Debug API
- Browse raw data
- Monitor system
- Manage members read-only
- Audio recording management
- Floor plan designer
- About pages CMS
- Point ledger + Gantt
- Activity log (SSE)

**Visibility:** Admin / Boss only — ไม่อยู่ใน main nav

### Auth Gate
**ใช้ทำอะไร:** กัน non-admin เข้าถึง
- Check token → check role → ผ่านถึงจะเห็นเนื้อหา

### Top Header
**ใช้ทำอะไร:** identity + system status
- Logo + DEV badge — บอกว่าอยู่ใน dev mode
- Back link → main app
- User chip + role badge
- **SSE indicator** — สำคัญ! บอกว่าระบบ realtime ทำงานไหม
- Clock — ดูเวลา server

### Sidebar — 3 Sections
**ใช้ทำอะไร:** จัดกลุ่ม panels ตาม use case

| Section | Panels | ใช้ทำอะไร |
|---|---|---|
| หลัก | API, Data, System | Debug + Monitor |
| Lab | Whiteboard, Components, Room, About, Files, Ledger, Log, Notes | Tools + Experiments |
| Admin | Settings, Members | Configuration + Read-only data |

---

## 23. Dev Panel: API Playground

### ใช้ทำอะไร
**ทดสอบ API endpoints โดยไม่ต้องใช้ Postman**

### 23.1 Quick Presets
**ใช้ทำอะไร:** ปุ่มลัด endpoints ที่ใช้บ่อย — คลิกเดียวเรียกได้

### 23.2 Request Builder
**ใช้ทำอะไร:** ปรับ method/URL/body/headers แล้วยิง request
- เห็น response status + time + body
- ตรวจ JSON validity

### 23.3 Response Card
**ใช้ทำอะไร:** ดูผลลัพธ์
- Status pill สีตาม code (200 เขียว, 4xx ส้ม, 5xx แดง)
- Copy button — เอา response ไปใช้ต่อ

### 23.4 History
**ใช้ทำอะไร:** ดู requests ที่เพิ่งยิง — repeat / debug

---

## 24. Dev Panel: Data Explorer

### ใช้ทำอะไร
**Browse data ในระบบ raw — ไม่ต้องผ่าน UI**

### 24.1 Overview Stats
**ใช้ทำอะไร:** counter รวม members/groups/tasks/connections — sanity check ทั่วไป

### 24.2 Browse Collection
**ใช้ทำอะไร:** เลือก collection → ดู rows
- Filter `key=value` — narrow ลง
- ⬇ JSON — download raw

**Use cases:** debug query, export ข้อมูลก่อน migration, ตรวจสอบ data integrity

---

## 25. Dev Panel: System Info

### ใช้ทำอะไร
**รู้สถานะ server + session ปัจจุบัน**

### Cards

| Card | ใช้ทำอะไร |
|---|---|
| Client/Server | host, protocol, timezone, time — environment check |
| SMTP/Mailer | email config — ดูว่าส่งอีเมลได้ไหม |
| Session | token preview + member info — debug auth |
| /api/stats | raw stats JSON — refresh ได้ |

---

## 26. Dev Panel: Whiteboard

### ใช้ทำอะไร
**Whiteboard + Audio Recorder ใน dev — ทดสอบ + admin features**

### Sub-tab: Whiteboard
**ใช้ทำอะไร:** เหมือน main app — แต่อยู่ในบริบท dev
- เพิ่ม edit-frame modal — แก้ injected entity เต็มรูป

### Sub-tab: Audio Recorder
**ใช้ทำอะไร:** จัดการ recordings ทั้งหมด

#### Recorder Card
**ใช้ทำอะไร:** อัด/หยุด/import ไฟล์เสียง
- รองรับ mp3/wav/flac/aac/ogg/opus/m4a/wma/webm/aiff/amr — รับได้ทุก format
- Waveform visualizer — ดู audio level

#### Recordings List
**ใช้ทำอะไร:** ดู clip ทั้งหมด + transcript + summary
- "👀 ดู clips ทุกคน (admin)" — bypass owner filter
- Per clip: play / transcript status / summary status / edit / delete

---

## 27. Dev Panel: Component Lab

### ใช้ทำอะไร
**Playground สำหรับ UI component — ทดลอง HTML/CSS/JS โดยไม่ touch main app**

### Tab Bar
| Tab | ใช้ทำอะไร |
|---|---|
| preview | sandboxed iframe — เห็นผลลัพธ์จริง |
| html | edit HTML |
| css | edit CSS |
| js | edit JS |

**ปุ่ม:** ▶ Run / ↺ Reset / ↗ New Tab

**Use cases:** ออกแบบ component ใหม่, ทดสอบ snippet, demo

---

## 28. Dev Panel: Room Designer

### ใช้ทำอะไร
**ออกแบบ floor plan ห้อง lab — 2D/3D visualization**

ใช้สำหรับ:
- Plan layout ของห้อง
- ระบุตำแหน่งอุปกรณ์
- Onboard คนใหม่ — "นี่คือห้องเรา"

### Top Card
**ใช้ทำอะไร:** จัดการห้องหลายห้อง (lab มีหลายห้อง)
- Select/Rename/Duplicate/Delete
- Export/Import JSON — share configs

### Meta Row
**ใช้ทำอะไร:** ตั้ง scale + grid behavior
- W/H = dimensions ห้อง (m)
- Scale = px/m
- Snap = grid snapping
- Grid checkbox = แสดง grid
- Collide checkbox = collision detection

### Editor 3-column

#### Left: Catalog
**ใช้ทำอะไร:** drag-drop items into canvas
- 4 categories: structure (wall/door/window), furniture, onsurface (laptop), device (printer/server)
- "+ Custom" — สร้างของเอง

#### Center: Canvas
**ใช้ทำอะไร:** วาง object บน plan
- 2D mode — top-down view
- 3D mode — Three.js render
- Rulers (top/left) — measure
- Zoom + fit

#### Right: Properties
**ใช้ทำอะไร:** edit object ที่เลือก
- Position, rotation, size, color, notes

### Custom Item Modal
**ใช้เมื่อ:** ต้องการ object ที่ไม่ใน catalog
**Fields:** icon, label, w, h, z (depth), color, category

---

## 29. Dev Panel: About Editor

### ใช้ทำอะไร
**CMS สำหรับ About pages — สร้าง content โดยไม่ต้องเขียนโค้ด**

ใช้สำหรับ:
- About lab
- Project highlights
- Onboarding docs

### Header
**ใช้ทำอะไร:** จัดการหลายหน้า + edit/preview/save
- Title input
- Slug select
- New/Rename/Delete
- Edit/Preview toggle
- Export/Import/Save

### Insert Toolbar — 14 Block Types
**ใช้ทำอะไร:** เพิ่ม content block
- h1/h2/h3 — heading hierarchy
- paragraph — text
- image — media
- list-ul/ol — bullet/numbered
- quote — quote block
- callout — highlighted box
- link — hyperlink
- code — code snippet
- divider — separator
- video — embed
- columns — multi-column layout

### Edit Card
**ใช้ทำอะไร:** drag-drop block ordering
- Per-block editor + duplicate/delete

### Preview Card
**ใช้ทำอะไร:** เห็น output ที่ user จะเห็น

---

## 30. Dev Panel: Files Browser

### ใช้ทำอะไร
**Browse ไฟล์ทั้งหมดในระบบ — uploads, attachments**

ใช้สำหรับ:
- ตรวจ storage
- Find orphan files
- Debug upload issues

### Top Card
**ใช้ทำอะไร:** navigation
- Breadcrumb — รู้ตำแหน่ง
- Reload / Up / Root — move

### Table
**ใช้ทำอะไร:** list entries
- Icon ตาม type
- Actions: เข้า (dirs) / ดู / ⬇ (files)
- Links pass JWT — เปิด tab ใหม่ได้

---

## 31. Dev Panel: Point Ledger

### ใช้ทำอะไร
**ดู points ทั้งหมดในระบบ — table + Gantt timeline**

ใช้สำหรับ:
- Audit points — รู้ว่าใครได้เท่าไหร่
- Performance review
- Export report

### Filter Card
**ใช้ทำอะไร:** narrow scope
- Member select — focus เดียวคน
- Search
- "รวม unconfirmed" — ดู ledger เต็ม
- View toggle: Table / Gantt

### Summary Tiles
**ใช้ทำอะไร:** สถิติด่วน
- Rows / Total / Members / Tasks / Earliest / Latest

### Table View — Sortable
**ใช้ทำอะไร:** ดูทีละ row + sort คอลัมน์ใดก็ได้
- Sortable: earned_at (default) / member / points / task / group / role / phase / status

### Gantt View
**ใช้ทำอะไร:** visualize timeline
- Pins = วันที่ได้ points
- Lanes = members
- Bars = task duration
- Today line — referent ปัจจุบัน
- Auto-scroll today

### Pin Detail Popup
**ใช้เมื่อ:** คลิก pin
**ใช้ทำอะไร:** ดูรายละเอียด pin + jump ไป task/group

---

## 32. Dev Panel: Activity Log

### ใช้ทำอะไร
**ดู real-time events จาก SSE — debug + monitor**

### Event Stream Card
**ใช้ทำอะไร:**
- Connect/Stop SSE stream
- Clear log
- ดูข้อมูล events: timestamp + actor + action + target

**Use cases:**
- Debug ระบบ realtime
- Trace user actions
- Monitor traffic

---

## 33. Dev Panel: Dev Notes

### ใช้ทำอะไร
**Scratchpad ส่วนตัวสำหรับ admin/dev**

### Card
- Auto-save indicator
- ล้าง button
- Textarea — เก็บใน localStorage
- **Persistent:** กลับมาดูใหม่เห็นเหมือนเดิม

**Use cases:** TODO ส่วนตัว, จดสิ่งที่ต้องแก้, snippet เก็บ

---

## 34. Dev Panel: Settings

### ใช้ทำอะไร
**System-wide configuration — เป็น UI สำหรับ `PUT /api/settings`**

### System Settings Card
**ใช้ทำอะไร:** toggle/set value ต่างๆ
- `email_invitations_enabled` — เปิด/ปิดส่งอีเมล meetings อัตโนมัติ
- Underscore-prefixed keys ซ่อน — internal config

### Diagnostics Card
**ใช้ทำอะไร:** quick checks
- Health Check — เรียก `/healthz`
- SMTP Info — ดู mail server config

---

## 35. Dev Panel: Members

### ใช้ทำอะไร
**Read-only member list — รู้ใครอยู่ในระบบ**

> **Note:** ไม่มี edit/delete/password reset ใน UI นี้ — ทำผ่าน API Playground

### Member List Card
**ใช้ทำอะไร:** ค้นหา + ดูข้อมูล member
- Search box + Refresh
- Table: ชื่อ / Role / Points / Color / สร้างเมื่อ

---

## 36. Dev Page: All Modals

| Modal | Purpose |
|---|---|
| `#auth-overlay` | Block non-admin access |
| `#toast` | Non-blocking notification |
| `#rm-custom-modal` | สร้าง custom catalog item (Room Designer) |
| `#wb-edit-frame-modal` | แก้ injected entity ใน whiteboard |
| `#wb-inject-modal` | inject card from data |
| `#wb-paper-size-menu` | เลือก paper size popover |
| `#pl-pin-popup` | Point Ledger pin detail |

---

# Part D — Reference

## 37. Database Schema

### 37.1 ENUMs / Constants

| Constant | Values | ใช้ทำอะไร |
|---|---|---|
| `VALID_STATUS` | idea, proposal, pending_approval, in_progress, delivery, maintenance, completed, on_hold, cancelled, archived | lifecycle ของ task/group |
| `VALID_ROLE` | boss, admin, member | สิทธิ์ |
| `VALID_TASK_ROLE` | leader, member | บทบาทใน task |
| `VALID_KIND` | task, meeting | distinguish task vs meeting |
| `VALID_LOCATION_TYPE` | (empty), online, onsite_internal, onsite_external | สถานที่ประชุม |
| `VALID_CONNECTION_KIND` | personal, agency, lobbyist | ประเภท connection |

### 37.2 Tables (สรุปย่อ)

| Table | ใช้ทำอะไร |
|---|---|
| `members` | สมาชิก + role + auth |
| `app_settings` | global config |
| `task_groups` | โครงการ + soft-delete |
| `tasks` | งาน + meeting (kind) + soft-delete |
| `task_assignees` | ผู้รับผิดชอบ task (M2M) |
| `connections` | ผู้ติดต่อภายนอก |
| `task_files` | ไฟล์แนบ task |
| `group_members` | สมาชิกของ group (M2M) |
| `group_connections` | connection ที่ผูก group (M2M) |
| `group_invitations` | คำเชิญ/เสนอตัวเข้ากลุ่ม |
| `task_invitations` | คำเชิญเข้า task |
| `deadline_requests` | คำขอเลื่อน deadline |
| `categories` | tag ของ task |
| `task_categories` | M2M task ↔ category |
| `leaves` | วันลา |
| `point_requests` | คำขอเพิ่ม points |
| `whiteboards` | กระดานวาด |
| `whiteboard_members` | สมาชิกที่เข้าถึง board |
| `recordings` | audio + transcript + summary |
| `task_comments` | comments + soft-delete |
| `polls` | โพล |
| `poll_votes` | คะแนนโหวต |
| `audit_events` | log การกระทำ |

---

## 38. API Endpoints (สรุป)

> `hasAdminPerms(user)` = `role === 'admin' || role === 'boss'`

### Endpoint Groups

| Group | จำนวน | ใช้ทำอะไร |
|---|---|---|
| Auth/Self | 6 | login/logout/me/password/avatar |
| Members | 4 | CRUD members (admin) |
| Groups | 18 | CRUD + trash + invite/propose + members + summary + export |
| Files | 4 | browse/upload/download |
| Tasks | 18 | CRUD + trash + comments + assignees + files + send-invite |
| Points | 11 | propose/leader-approve/confirm/reopen + requests |
| Connections | 4 | CRUD |
| Deadline Requests | 3 | CRUD + decide |
| Categories | 4 | CRUD |
| Leaves | 4 | CRUD |
| Polls | 6 | CRUD + vote/close |
| Whiteboards | 8 | CRUD + members + inject |
| Recordings | 7 | CRUD + transcribe/summarise/stream |
| Stats/Admin | 4 | stats/settings/audit |
| Misc | 3 | healthz/dev/events (SSE) |

**Total:** ~100+ endpoints

---

## 39. Status & Enum Constants

### 39.1 Task / Group Lifecycle — ทำไมแบ่งแบบนี้

```
idea → proposal → pending_approval → in_progress → delivery → maintenance → completed
                                          ↓                           ↑
                                       on_hold                    archived
                                       cancelled (trash)
```

| Status | สี | Icon | ใช้เมื่อ |
|---|---|---|---|
| `idea` | gray | 💡 | เพิ่งคิด ยังไม่เริ่ม discuss |
| `proposal` | blue | 📝 | เสนอแล้ว รอความเห็น |
| `pending_approval` | amber | ⏳ | รออนุมัติจาก admin/funding |
| `in_progress` | orange | 🔨 | กำลังทำ — เกือบทั้งหมดอยู่ที่นี่ |
| `delivery` | purple | 🚚 | กำลังส่งมอบงาน |
| `maintenance` | cyan | 🔧 | ส่งมอบแล้ว แต่ยัง maintain |
| `completed` | emerald | ✅ | เสร็จสมบูรณ์ |
| `on_hold` | gray | ⏸️ | พักไว้ ยังไม่ start หรือพักกลางคัน |
| `cancelled` | rose | ❌ | ยกเลิก — ลงถังขยะ |
| `archived` | slate | 📦 | เก็บ — เสร็จแล้วเก็บแล้ว |

### 39.2 Points Workflow Phase — ทำไม 4 phases

| Phase | สี | ใช้เมื่อ | เหตุผล |
|---|---|---|---|
| `none` | gray | งานยังไม่เสร็จ | default |
| `proposing` | 🟦 blue | เพิ่งเสร็จ assignees เสนอ | self-assessment first — ลด bias |
| `leader_review` | 🟨 amber | leader review | leader ปรับให้แฟร์ |
| `final_review` | 🟪 purple | admin confirm รอบสุดท้าย | check รอบสองก่อนแจกจริง |
| `confirmed` | ✅ emerald | แจก points แล้ว | locked — แก้ต้อง reopen |

### 39.3 Meeting Location Type

| Value | Icon | ใช้เมื่อ |
|---|---|---|
| `online` | 🌐 | ประชุม Zoom/Meet/etc. |
| `onsite_internal` | 🏢 | ในห้อง lab |
| `onsite_external` | 📍 | นอกสถานที่ |
| (empty) | - | ไม่ระบุ |

### 39.4 Connection Kind

| Value | Icon | ใช้เมื่อ |
|---|---|---|
| `personal` | 🏢 | บริษัทที่ member เป็น contact หลัก |
| `lobbyist` | 🎯 | บุคคลกลางที่ไม่ผูกหน่วยงาน |
| `agency` | 🏛️ | หน่วยงานราชการ มี liaisons หลายคน |

### 39.5 Group Invitation Kind

| Kind | ใช้เมื่อ |
|---|---|
| `invite` | admin/leader เชิญสมาชิกเข้ากลุ่ม |
| `proposal` | สมาชิกเสนอตัวเข้ากลุ่ม leaderless |
| `claim` | admin/leader หยิบกลุ่ม leaderless เป็น leader |

### 39.6 Recording Status

| Status | ใช้เมื่อ |
|---|---|
| `pending` | รอเริ่ม transcribe |
| `processing` | กำลัง transcribe |
| `done` | เสร็จ |
| `error` | ผิดพลาด |
| `skipped` | ข้าม (manual) |

---

## 40. Design System

### 40.1 Colors

#### Primary
- **Indigo `#6366f1`** — primary action, links, focus
- **Cyan `#22d3ee`** — gradient pair

#### Status Colors

| Color | Hex | ใช้ทำอะไร |
|---|---|---|
| Rose | `#f43f5e` | error, overdue, delete |
| Emerald | `#10b981` | success, completed |
| Amber | `#f59e0b` | warning, leader_review |
| Blue | `#3b82f6` | info |
| Purple | `#a855f7` | final review |
| Orange | `#f97316` | urgent |
| Slate | - | neutral, dark mode |

#### Role Colors
- **Boss** — gold gradient ring + bg (เน้น hierarchy)
- **Admin** — amber/blue
- **Member** — slate gray

#### Group Palette (51 colors, 3 tiers × 17)
- **Light tier** — soft pastels (card backgrounds)
- **Medium tier** — standard saturation (default)
- **Bold tier** — vivid (hero gradients, เลี่ยง yellow/lime ที่ตุ่น)

### 40.2 Typography
- **Font:** Prompt (Google Fonts) — weights 300-700
- **Reasoning:** Prompt เป็น Thai font ที่อ่านง่ายในจอเล็ก + รองรับ Latin

### 40.3 Spacing & Radius

| Element | Radius | ใช้ทำอะไร |
|---|---|---|
| Card | `rounded-2xl` (16px) | soft, modern |
| Button | pill/`rounded-full` | tactile, fingertip-friendly |
| Input | pill `h-12` (48px) | touch target |
| Modal desktop | `rounded-2xl` | consistent |
| Modal mobile | `rounded-t-3xl` | slide-up indicator |

### 40.4 Shadows

| Use | Shadow |
|---|---|
| Card | soft `rgba(0,0,0,0.06)` 0 1px 3px |
| Modal/Sheet | `shadow-xl/2xl` |
| Input/Select/Chip | **ไม่มี** — สะอาด, ดูเรียบ |

### 40.5 Components Catalog

#### Buttons

| Class | ใช้ทำอะไร |
|---|---|
| `ios-btn-primary` | indigo bg — main action (สร้าง/บันทึก) |
| `ios-btn-secondary` | gray bg — secondary action |
| `ios-btn-ghost` | transparent — tertiary (cancel, link-like) |
| `ios-btn-icon` | square 36px — icon-only |

**Min touch target:** 44×44px

#### Inputs

| Class | ใช้ทำอะไร |
|---|---|
| `ios-input` | pill h-12 — text/email/tel/number |
| `ios-select` | pill dropdown |
| `ios-chip` | selectable badge — categories, status filters |
| `ios-label` | small uppercase gray — form labels |

#### Avatars
- Circle, fallback initials
- Hash-based gradient bg — ทุกคนได้สีเฉพาะ
- Sizes: 32 (small) / 48 (medium) / 96 (large)

#### Badges
- Status badge — rounded-full + color
- Bell badge — red dot top-right (count, "99+" cap)
- Filter badge — indigo dot — บอกว่ามี filter active

### 40.6 Animations
- **Transition:** 200ms ease — ไม่ช้าเกินไป ไม่กระตุก
- **Modal slide-up:** mobile (natural gesture)
- **Modal fade:** desktop
- **Drag ghost** + drop zone highlight

### 40.7 Dark Mode
- 3 modes: Auto / Light / Dark
- Auto = ตาม OS preference
- ใช้ CSS variable
- Backgrounds: slate-900 / slate-800
- Text: slate-100 / slate-300

### 40.8 Safe Areas (iOS)
- `safe-bottom`: `env(safe-area-inset-bottom)`
- Topbar padding-top: `env(safe-area-inset-top)`
- Tabbar height + safe area

### 40.9 Z-Index Layers — เหตุผลการเรียง

| Layer | z-index | ใช้ทำอะไร |
|---|---|---|
| Sheet | 40 | task detail, member detail |
| Submit Sheet | 45 | บนสุดของ task — submit ไฟล์ |
| Notif Sheet | 50 | bell notifications |
| Filter Sheet | 50 | tasks filter |
| Preview Sheet | 55 | file preview — over everything ปกติ |
| Modal | 60 | form modals — บน sheet |
| Confirm Modal | 70 | confirm action — บน modal |
| Toast | 70 | non-blocking |
| Prompt Modal | 72 | prompt text — บน confirm |
| Doctype Picker | 75 | picker บน prompt |

---

## 41. Constraints

### 41.1 Device & Display — ทำไมออกแบบแบบนี้

| Constraint | เหตุผล |
|---|---|
| มือถือเป็นหลัก | ทีมใช้นอกออฟฟิศ + accessibility |
| iPad portrait → bottom tabbar | 6 ปุ่ม อัด topbar ไม่ลง |
| iPad landscape + desktop → top nav | จอกว้างพอ |
| Apple Pencil support | จด meeting บนกระดาน |
| ไม่ pinch-zoom | UI ต้องอ่านง่ายโดยไม่ซูม |
| Min touch 44×44px | iOS HIG standard |

### 41.2 Network & Offline — ทำไมต้อง PWA
- ทำงานนอกออฟฟิศบ่อย → wifi unstable
- **Network-first สำหรับ HTML** — UI update เร็ว
- **Cache-first สำหรับ audio** — immutable URLs
- **Stale-while-revalidate JS/CSS** — fast load + auto-update

### 41.3 Localization
- **ภาษาไทยเป็นหลัก** — ทีมไทย
- **Emoji ใช้คู่ข้อความ** — quick recognition
- **Abbreviation search (878 entries)** — รัฐกิจไทยเยอะมาก
- **dd/mm/yyyy + 24-hour** — Thai standard

### 41.4 Visibility & Permission
- Role-based hide/show ขึ้นมาเมื่อ login
- **SW postMessage → reload เมื่อ update** — role visibility apply ทันที
- Nav order ต่างกันต่อ role

### 41.5 Data Persistence
- **Soft-delete 30 วัน** — recovery window
- Group restore cascades to tasks
- Filter state in localStorage — กลับมาเหมือนเดิม

### 41.6 Real-time
- SSE `/api/events` — push updates
- Multi-user whiteboard cursor — collaborative awareness

### 41.7 Email Integration
- iMIP invite สำหรับ meetings
- Re-send invite (auto-bump sequence)
- Cancel meeting → CANCEL email auto
- @mention → in-app เท่านั้น (กัน spam email)

### 41.8 File Handling
- Per-file doc_type — archive จัดได้
- Preview in-app (image/PDF/video/audio/text/docx/xlsx)
- Thai filename (RFC 5987)

### 41.9 Color Palette Rules
- ทุกกลุ่ม **สีไม่ซ้ำ** — กัน confusion
- 3 tiers: light/medium/bold
- เลี่ยง yellow/lime (ตุ่นเมื่ออ่าน)

### 41.10 Browser Support
- Chrome / Safari / Edge (latest 2)
- iOS Safari 14+
- Android Chrome
- ไม่ support IE

---

## 42. Design Direction Recommendations

จากการใช้งานจริง + feedback ผู้ใช้:

### 42.1 ความเรียบง่าย > ตกแต่ง
**Feedback ผู้ใช้:** "เอาแบบเก่าสวยกว่า" (บ่อยมาก)
- ไม่ใช้ effect/animation มากเกินไป
- ไม่ใช้ gradient ที่ซับซ้อน

### 42.2 ไม่ใช้กรอบซ้อนกรอบ
**Feedback:** "ไม่ต้องมีกรอบ .conn-section-body สวยกว่า"
- Card ภายใน card → ไม่ต้องมี shadow ซ้อน
- `<details>` body ไม่ต้องมี border

### 42.3 ไม่มี shadow บน input/select
- Input ดูสะอาด
- ใช้ border สีเทาอ่อนแทน

### 42.4 Group color เป็น identity
- ใช้ border-left ในทุก card ของกลุ่ม
- ใช้ gradient bg ใน hero detail view
- ใช้ใน calendar pills

### 42.5 Emoji + ข้อความ ใช้ควบคู่
- Emoji = icon (เร็ว, สื่อความ, ตา recognize)
- ข้อความ = label (ชัดเจน, screen reader friendly)
- **ไม่ใช้แค่ emoji ลำพัง** (a11y)

### 42.6 Tap target ใหญ่
- ปุ่ม action ในการ์ดต้อง 44×44px ขั้นต่ำ
- Spacing ระหว่างปุ่มต้องเพียงพอ — กัน fat finger

### 42.7 Sticky header ในทุก scroll list
- ช่อง search / filter ต้องไม่หาย
- รวม modal/sheet headers

### 42.8 Avatar stack แทน list
- ประหยัดพื้นที่
- "+N" overflow บอกจำนวนที่เหลือ

### 42.9 Status badge ชัดเจน
- ใช้สีแยกชัด
- ไม่ใช้แค่ outline (อ่อนเกิน)

### 42.10 Loading state
- Skeleton screens > spinner
- บอก layout ก่อน

### 42.11 Error state
- Inline error ใต้ input — เห็นทันที
- Toast สำหรับ global error

### 42.12 Empty state
- Hero icon + ข้อความ + CTA button
- ไม่ใช่แค่ "No data"

---

## ✨ End of Specification

**Total scope:**
- **8 main pages** + login
- **13 dev panels**
- **30+ modals/sheets/popovers** ครบทุก use case
- **100+ API endpoints**
- **18 database tables**
- **10 status lifecycle values**

**Files referenced:**
- `frontend/public/index.html` (780 lines)
- `frontend/public/app.js` (10,657 lines)
- `frontend/public/dev.html` (6,761 lines)
- `frontend/public/style.css` (3,655 lines)
- `frontend/public/sw.js` (cache version v157)
- `backend/server.js` (2,140 lines)
- `backend/db.js` (2,669 lines)

**ส่งเอกสารนี้ให้ทีม Design ได้เลย — มีทั้ง "อะไร" และ "ทำไม" ครบ**
