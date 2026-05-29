# SMLWeb — User Requirements Document

> เอกสารระบุความต้องการของผู้ใช้ — ผู้ใช้คือใคร, เขาต้องการทำอะไร, ทำไมต้องการ และเกณฑ์การยอมรับ
>
> **Document type:** User Requirements Specification (URS)
> **Project:** SMLWeb (Smart City Lab Web App)
> **Team:** Smart City Lab @ KMITL
> **Version:** 2.0
> **Date:** 2026-05-22

---

## สารบัญ

1. [บทนำ](#1-บทนำ)
2. [ผู้ใช้และกลุ่มเป้าหมาย (User Personas)](#2-ผู้ใช้และกลุ่มเป้าหมาย)
3. [ปัญหาที่ผู้ใช้พบ (Pain Points)](#3-ปัญหาที่ผู้ใช้พบ)
4. [วัตถุประสงค์หลักของระบบ](#4-วัตถุประสงค์หลักของระบบ)
5. [User Stories](#5-user-stories)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Use Cases / Scenarios](#8-use-cases--scenarios)
9. [Acceptance Criteria](#9-acceptance-criteria)
10. [Constraints & Assumptions](#10-constraints--assumptions)
11. [Out of Scope](#11-out-of-scope)
12. [Success Metrics](#12-success-metrics)

---

## 1. บทนำ

### 1.1 วัตถุประสงค์ของเอกสาร
เอกสารนี้ระบุความต้องการของผู้ใช้สำหรับระบบ SMLWeb เพื่อเป็น single source of truth ให้ทีม Product/Design/Engineering ใช้ตัดสินใจ:
- Feature ไหนต้องมี / ไม่ต้องมี
- ระบบต้องตอบสนอง user goal อะไร
- เกณฑ์การ accept feature เป็นอย่างไร

### 1.2 ขอบเขต
ครอบคลุมระบบบริหารจัดการงานสำหรับทีม Smart City Lab @ KMITL:
- จัดการสมาชิก, โครงการ, งาน
- ระบบ Points แบบ workflow
- ปฏิทินรวม + ประชุม
- ผู้ติดต่อภายนอก
- Collaboration tools (whiteboard, comments)
- Notification + recording

### 1.3 คำจำกัดความ

| คำ | ความหมาย |
|---|---|
| ทีม | กลุ่มสมาชิกทั้งหมดใน Smart City Lab |
| สมาชิก / Member | คนที่มี account ในระบบ |
| โครงการ / Group | งานใหญ่ที่รวม task หลายๆงาน |
| งาน / Task | งานย่อย 1 ใบ |
| ประชุม / Meeting | task ประเภท `kind=meeting` |
| Points | คะแนนสะสมจากการทำงาน |
| Connection | ผู้ติดต่อภายนอก (บริษัท/หน่วยงาน/lobbyist) |
| Phase | ขั้นตอนใน points workflow |

---

## 2. ผู้ใช้และกลุ่มเป้าหมาย

### 2.1 Persona 1: อาจารย์ (Boss)

**ชื่อ:** อ.อ๊อด
**บทบาท:** หัวหน้า lab, อาจารย์ที่ปรึกษา
**อายุ:** 40+
**Tech-savviness:** ปานกลาง — ใช้มือถือคล่อง แต่ไม่ลงโค้ด

#### Goals
- ดู bird's-eye view ของทีม — ใครทำอะไร, โครงการไหนคืบหน้ายังไง
- รู้สถานะโครงการสำคัญ — งบประมาณ, deadline, ปัญหา
- ตัดสินใจอนุมัติ — point requests, deadline extensions
- ไม่ต้องการรายละเอียดงาน task ต่ำๆ

#### Behaviors
- เปิดแอปวันละ 1-2 ครั้ง (เช้า/เย็น)
- ใช้ iPad เป็นหลัก (portrait)
- ชอบข้อมูลเป็นภาพ (chart, badge) มากกว่าข้อความเยอะ
- ไม่ค่อยพิมพ์ — เน้นแตะ/อ่าน

#### Pain Points
- ไม่อยากเปิดหลายหน้าเพื่อดูข้อมูล
- ไม่ชอบ scroll นาน
- กลัวกดผิดแล้วทำงานเสีย

### 2.2 Persona 2: นักศึกษาพี่ใหญ่ (Admin)

**ชื่อ:** เคน
**บทบาท:** Lab Manager, นักศึกษา ป.โท
**อายุ:** 25-30
**Tech-savviness:** สูง — เขียนโค้ดได้, ใช้ admin tools

#### Goals
- สร้าง/แก้/ลบ task และโครงการ
- มอบหมายงานให้น้อง
- อนุมัติ point/deadline requests
- จัดการ member + connection
- ติดตาม progress ของแต่ละโครงการ
- Debug ระบบเมื่อมีปัญหา

#### Behaviors
- ใช้แอปทั้งวัน (laptop + มือถือ)
- ตัวกลางระหว่าง อาจารย์ กับ น้อง
- พิมพ์เยอะ — สร้าง task, เขียน description
- ใช้ keyboard shortcuts ได้

#### Pain Points
- ต้องตอบ request เยอะ
- สลับ context บ่อย (task → group → member)
- ต้อง onboard น้องใหม่บ่อย

### 2.3 Persona 3: นักศึกษา (Member)

**ชื่อ:** น้องเจน
**บทบาท:** นักศึกษา ป.ตรี / ป.โท
**อายุ:** 20-25
**Tech-savviness:** สูง — Gen Z, ใช้แอปคล่อง

#### Goals
- ทำงานที่ได้รับมอบหมายให้ทัน deadline
- ส่งไฟล์งาน
- รับ points
- รู้ว่าทีมประชุมเมื่อไหร่, ไปไหน
- ติดต่อสมาชิกในทีม
- ขอเพิ่ม points / ขอเลื่อน deadline เมื่อจำเป็น

#### Behaviors
- ใช้มือถือเป็นหลัก
- ตรวจ notification บ่อย
- ใช้ตอนนอกห้อง lab
- ทำงานหลายอย่างพร้อมกัน

#### Pain Points
- ลืม deadline
- งงว่าจะส่งงานยังไง / ไฟล์ประเภทไหน
- ไม่รู้ว่า points ของตัวเองได้เท่าไหร่
- ลืมว่าประชุมที่ไหน

### 2.4 Persona 4: น้องใหม่ (Onboarding Member)

**ชื่อ:** น้องเอม
**บทบาท:** นักศึกษา ป.ตรี เข้าใหม่
**อายุ:** 18-22
**Tech-savviness:** สูง แต่ยังไม่รู้จักทีม

#### Goals
- รู้จักทีม — สมาชิกมีใครบ้าง
- รู้ว่า lab ทำโครงการอะไร
- หา group ที่จะเข้าร่วม
- เข้าใจ workflow

#### Pain Points
- ไม่รู้จะเริ่มที่ไหน
- กลัวกดผิด
- ไม่กล้าถาม

---

## 3. ปัญหาที่ผู้ใช้พบ (Pain Points)

### 3.1 ก่อนมีระบบ
| ปัญหา | ผลกระทบ |
|---|---|
| ใช้ LINE/Email สื่อสาร งานหาย หา history ยาก | ทำงานช้า, ทำซ้ำ |
| Spreadsheet จัดการ point ไม่ flexible, error เยอะ | ไม่แฟร์, มีดราม่า |
| ลืม deadline ไม่มีระบบเตือน | งานเสีย |
| ติดต่อหน่วยงานราชการ — กระจาย contact ในมือถือใครๆ | หาเบอร์ไม่เจอ |
| ประชุม — ส่ง calendar invite manual, บางคนไม่ได้ | ขาดประชุม |
| น้องใหม่ — onboard ยาก ไม่รู้ทีมทำอะไร | เข้าทีมช้า |
| จดประชุม — ใช้ Notes หลายคนแยกกัน | ข้อมูลไม่ตรงกัน |

### 3.2 ปัญหาที่อยากให้ระบบช่วย

| ปัญหา | Feature ที่ตอบ |
|---|---|
| ไม่รู้ใครรับผิดชอบงานไหน | Task assignees + group leader |
| ไม่แฟร์เรื่อง points | 4-phase workflow |
| ลืม deadline | Notifications + calendar |
| Connection สับสน | 3-category system |
| ประชุม — invite manual | Auto iMIP email |
| น้องไม่กล้าเข้ากลุ่ม | "เสนอตัว" + "หยิบกลุ่ม" |
| ทีมไม่เห็นภาพรวม | Home + Overview/Summary |
| ออฟไลน์ — แอปใช้ไม่ได้ | PWA + service worker |
| ค้นหาหน่วยงานราชการ | Abbreviation search |
| Brainstorm — กระดาน whiteboard ออนไลน์ | Whiteboard collaborative |
| ประชุม — จดยาก | Recording + AI summary |

---

## 4. วัตถุประสงค์หลักของระบบ

### 4.1 Vision
**"ที่เดียว — รู้ทุกอย่างเกี่ยวกับทีม + ทำงานร่วมกันได้"**

### 4.2 Mission
ระบบต้อง:
1. **ลด friction** ในการทำงานร่วมกัน — ไม่ต้องสลับ tool
2. **โปร่งใส** เรื่อง points + workload
3. **เร็ว** — เปิดดูข้อมูลใน 5 วินาที
4. **ไว้ใจได้** — ไม่หาย, มี backup, มี audit
5. **ใช้สบาย** — มือถือ + iPad + desktop

### 4.3 Success Definition
- ทีม 100% ใช้ระบบเป็นหลัก (ไม่ใช้ LINE/Spreadsheet ทำงาน)
- ลด conflict เรื่อง points → 0
- ออนบอร์ดน้องใหม่ < 1 วัน
- ไม่มี deadline missed เพราะลืม

---

## 5. User Stories

### 5.1 Authentication & Profile

| ID | Story |
|---|---|
| US-AUTH-01 | ในฐานะสมาชิก ฉันต้องการ login ด้วยชื่อ + PIN เพื่อเข้าสู่ระบบ |
| US-AUTH-02 | ในฐานะสมาชิก ฉันต้องการเปลี่ยน PIN ตัวเองได้ เพื่อความปลอดภัย |
| US-AUTH-03 | ในฐานะสมาชิก ฉันต้องการอัพโหลด avatar เพื่อให้ทีมจำได้ |
| US-AUTH-04 | ในฐานะสมาชิก ฉันต้องการเปลี่ยน theme (light/dark/auto) เพื่อใช้สบายตา |

### 5.2 Home Dashboard

| ID | Story |
|---|---|
| US-HOME-01 | ในฐานะสมาชิก ฉันต้องการเห็นงานใกล้ deadline ของฉัน ในหน้าแรก เพื่อรู้สิ่งที่ต้องทำ |
| US-HOME-02 | ในฐานะสมาชิก ฉันต้องการเห็นประชุมใกล้จะถึง ในหน้าแรก เพื่อไม่ลืมประชุม |
| US-HOME-03 | ในฐานะสมาชิก ฉันต้องการเห็น points ของตัวเอง ในหน้าแรก เพื่อรู้ progress |
| US-HOME-04 | ในฐานะสมาชิก ฉันต้องการเห็นกลุ่มที่ยังไม่ได้เข้าร่วม เพื่อหาโอกาส contribute |
| US-HOME-05 | ในฐานะสมาชิก ฉันต้องการเห็น scoreboard ของทีม เพื่อเปรียบเทียบ + จูงใจ |
| US-HOME-06 | ในฐานะ admin ฉันต้องการเห็น pending requests ในหน้าแรก เพื่อไม่ลืม approve |

### 5.3 Tasks Management

| ID | Story |
|---|---|
| US-TASK-01 | ในฐานะ admin/leader ฉันต้องการสร้าง task ใหม่ เพื่อมอบหมายงาน |
| US-TASK-02 | ในฐานะ admin/leader ฉันต้องการสร้างหลาย task พร้อมกัน เพื่อประหยัดเวลา |
| US-TASK-03 | ในฐานะสมาชิก ฉันต้องการเห็น task ของฉันทั้งหมด ในรูปแบบ Kanban |
| US-TASK-04 | ในฐานะสมาชิก ฉันต้องการ drag-drop task เพื่อเปลี่ยน status ได้รวดเร็ว |
| US-TASK-05 | ในฐานะสมาชิก ฉันต้องการค้นหา task ตามชื่อ/group/หน่วยงาน |
| US-TASK-06 | ในฐานะสมาชิก ฉันต้องการ filter task ตาม status, group, target |
| US-TASK-07 | ในฐานะสมาชิก ฉันต้องการ sort task ตาม deadline/points/title |
| US-TASK-08 | ในฐานะสมาชิก ฉันต้องการเห็นรายละเอียดเต็มของ task เมื่อคลิก |
| US-TASK-09 | ในฐานะสมาชิก ฉันต้องการ comment ใน task เพื่อสื่อสารกับทีม |
| US-TASK-10 | ในฐานะสมาชิก ฉันต้องการ @mention เพื่อแจ้งคนเฉพาะ |
| US-TASK-11 | ในฐานะสมาชิก ฉันต้องการอัพโหลดไฟล์ส่งงาน |
| US-TASK-12 | ในฐานะสมาชิก ฉันต้องการระบุ doc_type ของไฟล์ที่ส่ง |
| US-TASK-13 | ในฐานะสมาชิก ฉันต้องการลบ task ที่ไม่ใช้ → ลงถังขยะ |
| US-TASK-14 | ในฐานะสมาชิก ฉันต้องการกู้คืน task ใน 30 วัน |
| US-TASK-15 | ในฐานะสมาชิก ฉันต้องการขอเลื่อน deadline พร้อมเหตุผล |

### 5.4 Group / Project Management

| ID | Story |
|---|---|
| US-GRP-01 | ในฐานะ admin ฉันต้องการสร้างโครงการใหม่ + กำหนด leader |
| US-GRP-02 | ในฐานะ leader ฉันต้องการแก้ไขข้อมูลโครงการ |
| US-GRP-03 | ในฐานะสมาชิก ฉันต้องการเสนอตัวเข้ากลุ่มที่ยังไม่มี leader |
| US-GRP-04 | ในฐานะ admin/leader ฉันต้องการ "หยิบ" กลุ่มมาเป็น leader |
| US-GRP-05 | ในฐานะ leader ฉันต้องการเชิญสมาชิกเข้ากลุ่ม |
| US-GRP-06 | ในฐานะ leader ฉันต้องการ approve/reject ผู้เสนอตัว |
| US-GRP-07 | ในฐานะสมาชิก ฉันต้องการดูรายละเอียดโครงการ — tasks, files, members |
| US-GRP-08 | ในฐานะสมาชิก ฉันต้องการเห็นโครงการที่เก็บ (archived) แยก |
| US-GRP-09 | ในฐานะ admin ฉันต้องการ archive โครงการที่เสร็จแล้ว |
| US-GRP-10 | ในฐานะ leader ฉันต้องการเปลี่ยนสีโครงการให้เป็น identity ที่จำง่าย |
| US-GRP-11 | ในฐานะ leader ฉันต้องการผูก connection (หน่วยงาน) กับโครงการ |
| US-GRP-12 | ในฐานะ admin ฉันต้องการ export โครงการเป็น CSV |
| US-GRP-13 | ในฐานะสมาชิก ฉันต้องการอ่าน AI summary ของโครงการ |

### 5.5 Points Workflow

| ID | Story |
|---|---|
| US-PTS-01 | ในฐานะ assignee ฉันต้องการเสนอ points ของตัวเอง หลังทำงานเสร็จ |
| US-PTS-02 | ในฐานะ leader ฉันต้องการ review + ปรับ points ของ assignees ก่อนส่งต่อ |
| US-PTS-03 | ในฐานะ admin/leader ฉันต้องการ confirm points สุดท้าย |
| US-PTS-04 | ในฐานะ admin/leader ฉันต้องการ reopen ที่ confirm แล้ว ถ้าผิด |
| US-PTS-05 | ในฐานะสมาชิก ฉันต้องการขอเพิ่ม points พร้อมเหตุผล หลัง confirm |
| US-PTS-06 | ในฐานะ admin ฉันต้องการเห็น point requests รอ approve |
| US-PTS-07 | ในฐานะ admin ฉันต้องการ approve/reject point requests |
| US-PTS-08 | ในฐานะ admin ฉันต้องการดู points ledger ทั้งหมด — table + Gantt timeline |
| US-PTS-09 | ในฐานะสมาชิก ฉันต้องการเห็น phase ปัจจุบันของแต่ละงาน |

### 5.6 Calendar & Meetings

| ID | Story |
|---|---|
| US-CAL-01 | ในฐานะสมาชิก ฉันต้องการเห็นปฏิทินรวม task + meeting + leave |
| US-CAL-02 | ในฐานะ admin/leader ฉันต้องการสร้างประชุม + ส่ง iMIP email อัตโนมัติ |
| US-CAL-03 | ในฐานะ admin/leader ฉันต้องการระบุประเภทประชุม (online/onsite_internal/onsite_external) |
| US-CAL-04 | ในฐานะ attendee ฉันต้องการคลิก URL ใน meeting → เข้า online meeting |
| US-CAL-05 | ในฐานะ admin/leader ฉันต้องการ resend email invite |
| US-CAL-06 | ในฐานะ admin/leader ฉันต้องการสร้าง task โดย preset deadline = วันที่เลือก |
| US-CAL-07 | ในฐานะสมาชิก ฉันต้องการคลิกวันใน calendar → ดูเฉพาะวันนั้น |
| US-CAL-08 | ในฐานะสมาชิก ฉันต้องการเห็นใครลาวันไหน ในปฏิทิน |
| US-CAL-09 | ในฐานะสมาชิก ฉันต้องการแจ้งลาวัน → ขึ้นปฏิทินทีม |

### 5.7 People / Members

| ID | Story |
|---|---|
| US-PPL-01 | ในฐานะสมาชิก ฉันต้องการดูรายชื่อสมาชิกทั้งหมด |
| US-PPL-02 | ในฐานะสมาชิก ฉันต้องการค้นหาสมาชิกตามชื่อ/email/เบอร์ |
| US-PPL-03 | ในฐานะสมาชิก ฉันต้องการ sort/filter ตาม role, points, จำนวนงาน |
| US-PPL-04 | ในฐานะสมาชิก ฉันต้องการดู profile รายคน — points, tasks, skill radar |
| US-PPL-05 | ในฐานะสมาชิก ฉันต้องการรู้ว่าใครกำลังลา (ติดต่อไม่ได้) |
| US-PPL-06 | ในฐานะสมาชิก ฉันต้องการคลิกโทร/อีเมล โดยตรงจากการ์ด |
| US-PPL-07 | ในฐานะ admin ฉันต้องการสร้าง/แก้/ลบ member |
| US-PPL-08 | ในฐานะ admin ฉันต้องการ assign role (boss/admin/member) |

### 5.8 Connections

| ID | Story |
|---|---|
| US-CON-01 | ในฐานะสมาชิก ฉันต้องการเก็บข้อมูล contact ภายนอก |
| US-CON-02 | ในฐานะสมาชิก ฉันต้องการแบ่ง connection 3 ประเภท (บริษัท/lobbyist/หน่วยงาน) |
| US-CON-03 | ในฐานะสมาชิก ฉันต้องการดู connection กรองตามประเภท |
| US-CON-04 | ในฐานะสมาชิก ฉันต้องการค้นหา connection ตามชื่อ/หน่วยงาน/topic |
| US-CON-05 | ในฐานะสมาชิก ฉันต้องการเห็นว่า connection นี้ผูกอยู่กับโครงการไหนบ้าง |
| US-CON-06 | ในฐานะสมาชิก ฉันต้องการค้นหาด้วยตัวย่อราชการ (เช่น "อบจ") |
| US-CON-07 | ในฐานะ leader ฉันต้องการผูก connection หลายอันกับโครงการเดียว |

### 5.9 Notifications

| ID | Story |
|---|---|
| US-NTF-01 | ในฐานะสมาชิก ฉันต้องการเห็น notification รวมจาก 🔔 ในที่เดียว |
| US-NTF-02 | ในฐานะสมาชิก ฉันต้องการเห็น overdue tasks ของฉัน |
| US-NTF-03 | ในฐานะสมาชิก ฉันต้องการเห็นเมื่อมีคน @mention ฉัน |
| US-NTF-04 | ในฐานะ admin ฉันต้องการเห็น pending requests รอ approve |
| US-NTF-05 | ในฐานะสมาชิก ฉันต้องการเห็นผล decided (approved/rejected) ของ request ฉัน |
| US-NTF-06 | ในฐานะ leader ฉันต้องการเห็นใครเสนอตัวเข้ากลุ่มฉัน |
| US-NTF-07 | ในฐานะสมาชิก ฉันต้องการ inline approve/reject ใน notification |
| US-NTF-08 | ในฐานะสมาชิก ฉันต้องการเห็น notification ใหม่ที่สุดอยู่บน |
| US-NTF-09 | ในฐานะสมาชิก ฉันต้องการเห็น bell badge แสดงจำนวน unread |

### 5.10 Polls

| ID | Story |
|---|---|
| US-PLL-01 | ในฐานะสมาชิก ฉันต้องการสร้าง poll เพื่อให้ทีมตัดสินใจร่วม |
| US-PLL-02 | ในฐานะสมาชิก ฉันต้องการตั้ง poll เป็น anonymous |
| US-PLL-03 | ในฐานะสมาชิก ฉันต้องการตั้ง poll เป็น multi-choice |
| US-PLL-04 | ในฐานะสมาชิก ฉันต้องการตั้งวันหมดอายุ poll |
| US-PLL-05 | ในฐานะสมาชิก ฉันต้องการโหวต + เปลี่ยนคำตอบได้ |
| US-PLL-06 | ในฐานะสมาชิก ฉันต้องการดูผล poll เป็น bar chart |
| US-PLL-07 | ในฐานะ creator/admin ฉันต้องการปิด/ลบ poll |

### 5.11 Whiteboard

| ID | Story |
|---|---|
| US-WB-01 | ในฐานะสมาชิก ฉันต้องการสร้าง whiteboard เพื่อ brainstorm |
| US-WB-02 | ในฐานะสมาชิก ฉันต้องการวาด/เขียนบน whiteboard ด้วย mouse/Apple Pencil |
| US-WB-03 | ในฐานะสมาชิก ฉันต้องการเลือกขนาดกระดาษ (A4/A3/Letter/infinite) |
| US-WB-04 | ในฐานะสมาชิก ฉันต้องการเปลี่ยน paper background (blank/grid/dot/lined) |
| US-WB-05 | ในฐานะสมาชิก ฉันต้องการ collaborate real-time กับสมาชิกอื่น |
| US-WB-06 | ในฐานะสมาชิก ฉันต้องการ inject task/group/meeting/points จากระบบ |
| US-WB-07 | ในฐานะสมาชิก ฉันต้องการ record audio ขณะวาด whiteboard (สำหรับประชุม) |
| US-WB-08 | ในฐานะสมาชิก ฉันต้องการ export whiteboard เป็น PNG |
| US-WB-09 | ในฐานะสมาชิก ฉันต้องการ auto-save (ไม่ต้องกดเอง) |
| US-WB-10 | ในฐานะสมาชิก ฉันต้องการ undo/redo |

### 5.12 Recording & Transcription

| ID | Story |
|---|---|
| US-REC-01 | ในฐานะสมาชิก ฉันต้องการ record เสียงประชุม |
| US-REC-02 | ในฐานะสมาชิก ฉันต้องการ import audio file (mp3/m4a/etc.) |
| US-REC-03 | ในฐานะสมาชิก ฉันต้องการ AI transcribe เสียง → ข้อความ |
| US-REC-04 | ในฐานะสมาชิก ฉันต้องการ AI summarize transcript |
| US-REC-05 | ในฐานะ admin ฉันต้องการเห็น recording ของทุกคน |

### 5.13 Admin / Dev Tools

| ID | Story |
|---|---|
| US-ADM-01 | ในฐานะ admin ฉันต้องการเข้า /dev เพื่อ debug |
| US-ADM-02 | ในฐานะ admin ฉันต้องการ test API endpoint |
| US-ADM-03 | ในฐานะ admin ฉันต้องการ browse raw data |
| US-ADM-04 | ในฐานะ admin ฉันต้องการดู audit log (real-time SSE) |
| US-ADM-05 | ในฐานะ admin ฉันต้องการตั้งค่า SMTP + email toggle |
| US-ADM-06 | ในฐานะ admin ฉันต้องการดู point ledger ทั้งหมด (table + Gantt) |
| US-ADM-07 | ในฐานะ admin ฉันต้องการออกแบบ floor plan ห้อง |
| US-ADM-08 | ในฐานะ admin ฉันต้องการ CMS แก้ไข About pages |
| US-ADM-09 | ในฐานะ admin ฉันต้องการ browse files ทั้งหมดในระบบ |

---

## 6. Functional Requirements

### 6.1 ระบบ Authentication

#### FR-AUTH-01: Login
- **ต้องการ:** ระบบต้องตรวจสอบ name + PIN กับ database
- **เกณฑ์:** ผ่าน → return JWT token + user object | ไม่ผ่าน → 401 + error message
- **เวลา:** < 2 วินาที

#### FR-AUTH-02: Session
- **ต้องการ:** ระบบใช้ JWT bearer ใน Authorization header
- **เกณฑ์:** Token หมดอายุ → redirect login | Token valid → access ตาม role

#### FR-AUTH-03: Logout
- **ต้องการ:** ลบ token จาก localStorage + redirect ไป login screen

### 6.2 ระบบ Role-based Access Control

#### FR-RBAC-01: 3 Role
- **ต้องการ:** boss / admin / member — มี hierarchy ชัดเจน
- **เกณฑ์:** boss = admin (สิทธิ์), member = น้อยสุด

#### FR-RBAC-02: API Authorization
- **ต้องการ:** ทุก endpoint ที่เปลี่ยนข้อมูลต้องตรวจ role
- **เกณฑ์:** member call admin endpoint → 403 Forbidden

#### FR-RBAC-03: UI Visibility
- **ต้องการ:** ปุ่ม/menu ที่เกินสิทธิ์ต้อง hide
- **เกณฑ์:** member ไม่เห็น "ลบ", "แก้ไข role"

### 6.3 ระบบ Task Management

#### FR-TASK-01: CRUD Task
- **ต้องการ:** Create/Read/Update/Delete task
- **Permission:**
  - Create: admin หรือ group leader
  - Update: admin หรือ group leader
  - Delete: admin หรือ group leader (soft delete)
- **เกณฑ์:** ลบ → status='cancelled', กู้คืนได้ 30 วัน

#### FR-TASK-02: Status Lifecycle
- **ต้องการ:** Task มี 10 status (idea → archived)
- **Transitions:** ไม่บังคับลำดับ — เปลี่ยนข้ามได้

#### FR-TASK-03: Multi-Assignee
- **ต้องการ:** Task มี assignees หลายคน
- **Role:** leader (1 คน) / member (หลายคน)

#### FR-TASK-04: Drag-Drop Status Change
- **ต้องการ:** drag task card → drop ที่ column อื่น → status update
- **Statuses supported:** on_hold, in_progress, completed

#### FR-TASK-05: Filter / Sort / Search
- **Filter:** status (multi), group, target
- **Sort:** 14 options
- **Search:** ครอบคลุม title, description, group, target — รองรับตัวย่อ

### 6.4 ระบบ Meeting

#### FR-MTG-01: Meeting Creation
- **ต้องการ:** Task kind='meeting' พร้อม end_time + location
- **Auto:** ส่ง iMIP email invite พร้อม .ics

#### FR-MTG-02: Re-send Invite
- **ต้องการ:** Manual button → ส่งอีกครั้ง (auto-bump ICS sequence)

#### FR-MTG-03: Cancel Meeting
- **ต้องการ:** ลบ meeting → ส่ง CANCEL email อัตโนมัติ

#### FR-MTG-04: Location Types
- **ต้องการ:** online (URL) / onsite_internal / onsite_external
- **เกณฑ์:** online → URL ใน chip คลิกได้

### 6.5 ระบบ Points Workflow

#### FR-PTS-01: 4-Phase Workflow
- **ต้องการ:** proposing → leader_review → final_review → confirmed
- **เกณฑ์:**
  - proposing: assignee เสนอ
  - leader_review: leader approve
  - final_review: admin confirm
  - confirmed: locked

#### FR-PTS-02: Self-Proposal
- **ต้องการ:** assignee ใส่ points ตัวเอง หลัง task completed

#### FR-PTS-03: Reopen
- **ต้องการ:** admin/leader reopen ที่ confirmed → กลับเป็น final_review

#### FR-PTS-04: Point Request
- **ต้องการ:** สมาชิกขอเพิ่ม points หลัง confirmed → admin ตัดสิน

### 6.6 ระบบ Group / Project

#### FR-GRP-01: CRUD Group
- **Permission:**
  - Create: admin
  - Update: admin / current leader
  - Delete: admin (soft)
  - Restore: admin / leader

#### FR-GRP-02: Leadership
- **ต้องการ:** group มี leader 1 คน
- **Transfer:** admin เปลี่ยนได้

#### FR-GRP-03: Member Management
- **Invite:** admin/leader → multi-select chips
- **Propose:** member → leader approve

#### FR-GRP-04: Color Identity
- **ต้องการ:** group ต้องมีสี
- **Warning:** ถ้าซ้ำกับกลุ่มอื่น → เตือน

#### FR-GRP-05: Connection Link
- **ต้องการ:** ผูก connection หลายอันกับ group (M2M)

#### FR-GRP-06: Soft-Delete + Restore
- **ต้องการ:** 30 วัน recovery window
- **Restore:** cascades to internal tasks

### 6.7 ระบบ Connection

#### FR-CON-01: 3 Types
- personal (บริษัท)
- lobbyist (บุคคล)
- agency (หน่วยงาน)

#### FR-CON-02: Conditional Fields
- **ต้องการ:** Fields ปรากฏตามประเภท
  - personal: company + contact_name
  - lobbyist: liaison_name (no company)
  - agency: liaison_name + company

#### FR-CON-03: Owner Permission
- **ต้องการ:** owner หรือ admin แก้ได้

### 6.8 ระบบ Calendar

#### FR-CAL-01: Unified View
- **ต้องการ:** แสดง task + meeting + leave ในปฏิทินเดียว

#### FR-CAL-02: Day-View Filter
- **ต้องการ:** คลิกวัน → ดูเฉพาะวันนั้น
- **Toggle:** คลิกซ้ำ → กลับเดือน

#### FR-CAL-03: Auto-Scroll Today
- **ต้องการ:** เปิดหน้า → scroll ไปวันนี้

#### FR-CAL-04: Quick Create
- **ต้องการ:** เลือกวัน → "+ task/meeting" → preset deadline

### 6.9 ระบบ Notifications

#### FR-NTF-01: Aggregator
- **ต้องการ:** รวม events 10 ประเภทใน bell

#### FR-NTF-02: Real-time SSE
- **ต้องการ:** notification ใหม่ → bell badge update ทันที (ไม่ต้อง refresh)

#### FR-NTF-03: Inline Actions
- **ต้องการ:** approve/reject ใน notification ได้

#### FR-NTF-04: Sort Newest First
- **ต้องการ:** notification ล่าสุดอยู่บน

### 6.10 ระบบ Files / Submission

#### FR-FILE-01: Upload
- **ต้องการ:** drag-drop หรือ click → choose files (multi)

#### FR-FILE-02: Doc Type Tagging
- **ต้องการ:** แต่ละไฟล์มี doc_type (เลือกจาก list)

#### FR-FILE-03: URL Link
- **ต้องการ:** ส่ง URL แทนไฟล์ได้

#### FR-FILE-04: Preview In-App
- **ต้องการ:** preview image/PDF/video/audio/text/docx/xlsx

#### FR-FILE-05: Thai Filename
- **ต้องการ:** ดาวน์โหลดได้พร้อม Thai filename (RFC 5987)

### 6.11 ระบบ Whiteboard

#### FR-WB-01: Collaborative Canvas
- **ต้องการ:** Fabric.js + WebSocket real-time sync

#### FR-WB-02: Multi-User Cursor
- **ต้องการ:** เห็น cursor ของ collaborator

#### FR-WB-03: Tools
- Draw / Highlight / Eraser
- Shapes (line, arrow, rect, circle, triangle, diamond)
- Text / Sticky / Image
- Style controls (color, stroke, fill)

#### FR-WB-04: Auto-Save
- **ต้องการ:** save ทุก 1.5 วินาที

#### FR-WB-05: Inject from System
- **ต้องการ:** ดึง task/group/meeting/points มาเป็น object บน canvas

#### FR-WB-06: Recorder
- **ต้องการ:** record audio + transcribe + summarize

### 6.12 ระบบ Poll

#### FR-POLL-01: Create
- **Fields:** question, options[], multi_choice, anonymous, expires_at

#### FR-POLL-02: Vote / Change
- **ต้องการ:** โหวต + เปลี่ยนคำตอบได้

#### FR-POLL-03: Anonymous
- **ต้องการ:** ถ้า anonymous=true → ไม่บันทึก voter_id (privacy)

#### FR-POLL-04: Auto-Close
- **ต้องการ:** เมื่อถึง expires_at → ปิดอัตโนมัติ

### 6.13 ระบบ Trash / Recovery

#### FR-TRASH-01: Soft-Delete
- **ต้องการ:** ลบ → deleted_at=NOW (30 วัน)

#### FR-TRASH-02: Categorized Trash
- **ต้องการ:** 3 sections (โครงการ / งาน / ประชุม)

#### FR-TRASH-03: Restore
- **ต้องการ:** กู้คืนได้
- **Cascade:** group restore → tasks ภายใน restore ด้วย

#### FR-TRASH-04: Permanent Delete
- **Permission:** admin only

### 6.14 ระบบ Admin / Dev Tools

#### FR-DEV-01: Access Gate
- **ต้องการ:** /dev เปิดเฉพาะ admin/boss

#### FR-DEV-02: 13 Panels
- API Playground, Data Explorer, System Info, Whiteboard, Component Lab, Room Designer, About Editor, Files Browser, Point Ledger, Activity Log, Dev Notes, Settings, Members

#### FR-DEV-03: Point Ledger Views
- **Table view:** sortable columns
- **Gantt view:** timeline ของ points

#### FR-DEV-04: Real-time SSE Log
- **ต้องการ:** ดู audit events stream real-time

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Metric | Target |
|---|---|
| Initial page load | < 3 วินาที (3G) |
| API response (CRUD) | < 500ms |
| Search response | < 200ms |
| Drag-drop status change | < 100ms (optimistic update) |
| Whiteboard cursor sync | < 100ms |
| Service worker cache hit | < 50ms |

### 7.2 Scalability

| Metric | Target |
|---|---|
| Concurrent users | 50+ |
| Tasks per group | 500+ |
| Files per task | 100+ |
| Recording duration | 4 hours |
| Whiteboard objects | 1000+ |

### 7.3 Availability

| Metric | Target |
|---|---|
| Uptime | 99.5% (working hours) |
| Offline mode | ใช้ระบบ cached ได้เมื่อ offline |
| Auto-reconnect SSE | yes |
| Auto-save whiteboard | every 1.5s |

### 7.4 Security

| Requirement | Detail |
|---|---|
| Authentication | JWT bearer token |
| Password storage | bcrypt hashed |
| Authorization | role-based + ownership check |
| HTTPS | required ใน production |
| CORS | restricted to known origins |
| Rate limiting | per-user API calls |
| Audit logging | ทุก admin action |

### 7.5 Usability

| Requirement | Detail |
|---|---|
| Touch target | min 44×44px |
| Tap response | visual feedback < 100ms |
| Language | ภาษาไทย primary |
| Date format | dd/mm/yyyy + 24-hour |
| Mobile-first | works on 375px width |
| Accessibility | WCAG 2.1 AA (target) |

### 7.6 Compatibility

| Platform | Requirement |
|---|---|
| Browser | Chrome 100+, Safari 14+, Edge 100+ |
| iOS Safari | iOS 14+ |
| Android Chrome | Android 10+ |
| PWA install | supported |
| Apple Pencil | supported (Whiteboard) |

### 7.7 Maintainability

| Requirement | Detail |
|---|---|
| Code structure | Frontend (vanilla JS) + Backend (Node.js + Express) |
| Database | PostgreSQL |
| File storage | local filesystem (containerized) |
| Deployment | Docker compose |
| Logging | console + audit table |
| Backup | manual/automated DB dump |

### 7.8 Localization

| Requirement | Detail |
|---|---|
| Primary language | ไทย |
| Secondary | English (button labels บางจุด) |
| Abbreviation search | รองรับ 878 รัฐกิจไทย |
| Filename | Thai support (RFC 5987) |
| Email subject | Thai support (RFC 2047) |

### 7.9 Privacy

| Requirement | Detail |
|---|---|
| Anonymous poll | ไม่บันทึก voter id |
| Data deletion | soft delete 30 วัน |
| Audit visibility | admin only |
| @mention | in-app only (no email leak) |
| Avatar | user-uploaded, no external |

---

## 8. Use Cases / Scenarios

### 8.1 UC-01: น้องใหม่เข้าทีม
**Actor:** Member (น้องเอม)
**Preconditions:** Admin สร้าง account แล้ว
**Steps:**
1. Login ด้วย name + PIN ที่ admin บอก
2. หน้า Home — เห็น greeting + role badge "Member"
3. ไปดู People → เห็นทีมทั้งหมด → คลิก profile แต่ละคน
4. ไป Summary → เห็นโครงการที่กำลัง active
5. ไปกลุ่มที่น่าสนใจ → กด "🙋 เสนอตัว"
6. รอ leader approve → ได้ notification
7. เปิด task ในกลุ่ม → เริ่มทำ

**Success:** อยู่ในทีมแล้ว เริ่มทำงานได้

### 8.2 UC-02: สร้าง Task ใหม่
**Actor:** Admin / Group Leader (เคน)
**Preconditions:** มีโครงการ
**Steps:**
1. ไปแท็บ Todo → กดปุ่ม "+"
2. เลือก "เพิ่มงาน — เลือก Group ก่อน"
3. เลือกกลุ่มที่ตัวเองนำ
4. กรอก title, description, deadline, budget, categories
5. ติ๊ก assignees จาก chip grid
6. กดบันทึก

**Alternative:** "+ เพิ่มอีก" → batch หลาย task พร้อมกัน

**Success:** Task ขึ้นใน Kanban + assignees ได้ notification

### 8.3 UC-03: ส่งงาน + รับ Points
**Actor:** Member (น้องเจน)
**Preconditions:** ได้ assign task
**Steps:**
1. เปิด Todo → เลือก task ของฉัน
2. คลิก task card → เปิด task sheet
3. กด "📎 ส่งงาน" → submission sheet
4. Drag-drop ไฟล์ → ติด doc_type
5. กด "⬆ ส่ง"
6. Auto: task → completed
7. Auto: prompt "ใส่ points ของฉัน" → กรอก
8. รอ leader review → final_review → confirmed
9. ได้ notification "✅ Points confirmed"

**Edge case:** ถ้าไม่เห็นด้วย points → กด "💎 ขอเพิ่ม Points" → admin ตัดสิน

### 8.4 UC-04: สร้างประชุม
**Actor:** Admin / Leader
**Preconditions:** มีโครงการ + email config OK
**Steps:**
1. ไป Calendar → เลือกวัน → "+ ประชุม"
2. หรือ Todo → "+" → meeting
3. กรอก title, description
4. เลือก location_type (online/onsite_internal/onsite_external)
5. กรอก URL / address (ถ้ามี)
6. เลือก group → ติ๊ก attendees
7. กรอก start + end time
8. บันทึก
9. Auto: ส่ง iMIP email + .ics attachment ไป attendees

**Success:** ประชุมขึ้นในปฏิทิน + attendees ได้ invite

### 8.5 UC-05: Brainstorm บน Whiteboard
**Actor:** ทั้งทีม (3-4 คน)
**Preconditions:** มี iPad + Apple Pencil หรือ desktop
**Steps:**
1. คนนึงสร้าง whiteboard ใหม่ → ตั้งชื่อ "ระบบ X — brainstorm"
2. คนอื่นเปิด link เดียวกัน → เห็น real-time
3. ใช้ตัวเลือก:
   - ✏️ Draw — วาดอิสระ
   - 📝 Text — typing
   - 🟡 Sticky — โน้ตติด
   - ➡️ Arrow — เชื่อม
4. กด 📥 Inject → ดึง task/group เก่ามาวาง refer
5. กด 🎙 Record — อัดเสียงประชุม
6. จบ — กด 💾 Export PNG → save เป็นรูป

**Success:** ทีมได้ visual brainstorm + recording + transcript

### 8.6 UC-06: ขอเลื่อน Deadline
**Actor:** Member
**Preconditions:** Task ใกล้ deadline แต่ทำไม่ทัน
**Steps:**
1. เปิด task → คลิก ✏️ แก้ไข → "⏰ ขอเลื่อน Deadline"
2. กรอก requested_deadline + เหตุผล
3. ส่ง
4. Admin/Leader ได้ notification
5. Admin approve → deadline อัพเดท → member ได้ notification "✅"
6. หรือ reject → member ได้ "❌" + เหตุผล

**Success:** กระบวนการโปร่งใส, ไม่มีดราม่า

### 8.7 UC-07: ค้นหาหน่วยงานราชการ
**Actor:** Member
**Preconditions:** กำลังหา connection ของ "องค์การบริหารส่วนจังหวัด"
**Steps:**
1. ไป People → Connections tab
2. พิมพ์ "อบจ" ในช่องค้นหา
3. ระบบเข้าใจตัวย่อ → แสดง "องค์การบริหารส่วนจังหวัด..."
4. คลิก connection → ดูข้อมูลครบ

**Success:** หาเจอเร็ว ไม่ต้องพิมพ์ชื่อเต็ม

### 8.8 UC-08: Admin Approve Requests
**Actor:** Admin
**Preconditions:** มี pending requests
**Steps:**
1. เปิดแอป → bell มี badge "5"
2. คลิก 🔔 → notifications sheet
3. เห็น list:
   - 💎 น้องเจน ขอเพิ่ม points (15 → 20) เหตุผล: "เพิ่มงานเอกสาร"
   - ⏰ เคน ขอเลื่อน deadline งาน X
4. กด ✅ อนุมัติ inline → ทำงานทันที
5. หรือเข้า Todo → Admin segment → เห็นใน column 3 "รอคอนเฟิร์ม"

**Success:** Admin จัดการ queue เร็ว

### 8.9 UC-09: Boss ดูภาพรวม
**Actor:** Boss (อ.อ๊อด)
**Preconditions:** มี role=boss
**Steps:**
1. Login → เห็น Home → scoreboard ของทีม
2. กดแท็บ Overview (position 2)
3. ดู:
   - Tasks tab → ตารางทุก task
   - Groups tab → card view ของทุกโครงการ
   - Members tab → ใครคะแนนเท่าไหร่
4. กรอง / sort ตามต้องการ

**Success:** ภาพรวมทีมใน 2-3 คลิก

### 8.10 UC-10: Offline Browse
**Actor:** Member
**Preconditions:** เคยใช้แอป online มาก่อน (SW cache แล้ว)
**Steps:**
1. ไม่มีเน็ต — เปิดแอป
2. แอปยังเปิดได้ (HTML cached)
3. ดู cached data: tasks, groups, calendar
4. เน็ตกลับมา → SSE reconnect → ข้อมูลใหม่ sync

**Success:** ใช้งานพื้นฐานได้ตลอด

---

## 9. Acceptance Criteria

### 9.1 ผ่านเกณฑ์ทั่วไป
ระบบจะถือว่าผ่าน UAT เมื่อ:
- ✅ Persona ทั้ง 4 (boss, admin, member, onboard) ทำ user stories ทั้งหมดได้
- ✅ Performance ตาม non-functional requirements
- ✅ Browser support ครอบคลุม (Chrome/Safari/Edge latest 2)
- ✅ Mobile-first responsive ผ่าน
- ✅ No data loss ใน 30-day trash window
- ✅ Audit log ครบทุก admin action

### 9.2 ตัวอย่าง Story-level Acceptance Criteria

#### US-TASK-04: Drag-drop status change
**Given** สมาชิกอยู่ที่ Todo Kanban
**When** ลาก task card จาก column "กำลังทำ" → drop ที่ "เสร็จแล้ว"
**Then**
- task.status อัพเดทเป็น "completed" ใน database
- card ย้ายไปยัง column ใหม่ทันที (optimistic update)
- ถ้า server reject → revert + แสดง error toast
- ถ้าเป็น completed → trigger points workflow

#### US-PTS-01: Self-propose points
**Given** สมาชิกเป็น assignee + task เพิ่ง completed
**When** prompt โผล่ "ใส่ points ของฉัน"
**Then**
- prompt focused บนช่อง input
- กรอกตัวเลข + enter → save
- points_phase → 'proposing'
- leader ได้ notification

#### US-CAL-02: Meeting iMIP invite
**Given** admin/leader สร้าง meeting + email_invitations_enabled=true
**When** บันทึก meeting
**Then**
- ทุก attendee ได้ email พร้อม .ics attachment
- email subject = "📅 [meeting title]" (Thai support)
- .ics มี SUMMARY, DTSTART, DTEND, LOCATION, ORGANIZER, ATTENDEES
- ICS sequence = 0

#### US-NTF-03: @mention notification
**Given** สมาชิก B comment "@A please check"
**When** comment ถูก save
**Then**
- A ได้ notification ใน bell
- A เปิด bell → เห็น preview comment (80 chars)
- คลิก → เปิด task sheet ที่ comment นั้น
- mark as read

#### US-WB-09: Auto-save
**Given** สมาชิกวาดบน whiteboard
**When** ทำ action (วาด/ลบ/เพิ่ม object)
**Then**
- หลัง 1.5 วินาที → save อัตโนมัติ (debounced)
- saved indicator แสดง "บันทึกแล้ว"
- collaborator เห็น change real-time ผ่าน WebSocket

---

## 10. Constraints & Assumptions

### 10.1 Technical Constraints

| Constraint | เหตุผล / ผลกระทบ |
|---|---|
| ใช้ Node.js + PostgreSQL | infrastructure ที่มีอยู่ |
| File storage แบบ local | ไม่ใช้ S3 (ราคาประหยัด) |
| ไม่ใช้ external auth (Google/Microsoft) | ทีมเล็ก, account จัดเอง |
| ไม่มี mobile native app | PWA พอ |
| ใช้ vanilla JS frontend (ไม่ใช้ React/Vue) | maintainability + size |

### 10.2 Business Constraints

| Constraint | เหตุผล |
|---|---|
| ทีมเล็ก (< 50 คน) | ไม่ต้อง enterprise features |
| งบประมาณจำกัด | self-host, ไม่ใช่ SaaS |
| ภาษาไทยเป็นหลัก | ผู้ใช้ทั้งหมดเป็นไทย |
| ไม่มี dedicated devops | ใช้ Docker compose |

### 10.3 User Constraints

| Constraint | เหตุผล |
|---|---|
| มือถือเป็นหลัก | ทีมทำงาน mobile-first |
| รองรับ Apple Pencil | iPad + จดประชุม |
| Offline-tolerant | wifi unstable นอกออฟฟิศ |
| ไม่มี desktop notification | ใช้ in-app เท่านั้น |

### 10.4 Assumptions

| สมมติฐาน | ความเสี่ยงถ้าไม่จริง |
|---|---|
| ผู้ใช้มี smartphone | สูง — ระบบ mobile-first |
| ผู้ใช้รู้จัก concept Kanban | กลาง — ต้อง onboarding ดี |
| ผู้ใช้ใช้ภาษาไทย | สูง — UI ภาษาไทย |
| Email SMTP ทำงานเสถียร | กลาง — มี fallback ใน UI |
| ทีมเล็ก ไม่ scale > 100 คน | กลาง — DB pattern simple |

---

## 11. Out of Scope

ระบบ **ไม่** ครอบคลุม:

### 11.1 Features ที่ไม่ทำ
- ❌ Self-signup — admin ต้องสร้าง account ให้
- ❌ Social login (Google/Microsoft/Facebook)
- ❌ Mobile native app (iOS/Android) — ใช้ PWA แทน
- ❌ Real-time video conferencing — ใช้ external (Zoom/Meet)
- ❌ Email client integration (Gmail/Outlook)
- ❌ Payment / billing
- ❌ Multi-tenant — เป็นระบบ lab เดียว
- ❌ Internationalization (i18n) — Thai only
- ❌ Public API for 3rd-party
- ❌ Markdown editor with WYSIWYG (raw markdown OK)
- ❌ Time tracking (Pomodoro, timesheets)
- ❌ Project Gantt chart (มีแต่ใน point ledger)
- ❌ CRM features (sales pipeline, deals)
- ❌ Inventory management

### 11.2 Integrations ที่ไม่ทำ
- ❌ Slack/Discord integration
- ❌ GitHub/GitLab webhook
- ❌ Google Drive / OneDrive sync
- ❌ Microsoft Teams
- ❌ Trello/Asana import
- ❌ Calendar sync (Google Calendar/Outlook)

### 11.3 Compliance ที่ไม่บังคับ
- ❌ GDPR (ไม่มีผู้ใช้ EU)
- ❌ HIPAA (ไม่ใช่ medical)
- ❌ PCI-DSS (ไม่มี payment)
- ✅ PDPA (Thai privacy) — ต้องระวัง

---

## 12. Success Metrics

### 12.1 Adoption Metrics

| Metric | Target | Measurement |
|---|---|---|
| Daily Active Users | 80%+ ของทีม | login per day |
| Weekly Active Users | 100% ของทีม | login per week |
| Task creation rate | 5+ tasks/week/admin | DB query |
| Comment usage | 50%+ tasks have comments | DB query |

### 12.2 Workflow Metrics

| Metric | Target |
|---|---|
| Points workflow completion rate | 95%+ ของ completed tasks |
| Average phase transition time | < 3 วัน |
| Point dispute rate | < 5% |
| Deadline extension request rate | < 10% |
| Deadline missed | < 5% |

### 12.3 Engagement Metrics

| Metric | Target |
|---|---|
| Notification open rate | 80%+ |
| @mention response time | < 24 ชม. |
| Meeting acceptance rate | 90%+ |
| File submission via app | 95%+ (vs email) |

### 12.4 Performance Metrics

| Metric | Target |
|---|---|
| Initial page load | < 3s |
| Time to interactive | < 4s |
| API p95 latency | < 1s |
| Error rate | < 1% |
| SSE uptime | 99%+ |

### 12.5 Quality Metrics

| Metric | Target |
|---|---|
| User-reported bugs/month | < 5 |
| Critical bugs (data loss) | 0 |
| Onboarding time น้องใหม่ | < 1 วัน |
| Help requests from members | declining trend |

---

## ภาคผนวก

### A. Related Documents
- `DESIGN_SPEC.md` — Design specification ครบทุกหน้า/section
- `README.md` — Setup + deployment guide

### B. Glossary

| คำ | ความหมาย |
|---|---|
| Boss | role สูงสุด (อาจารย์) |
| Admin | role กลาง (operator) |
| Member | role พื้นฐาน |
| Group / Project | โครงการ — รวมหลาย task |
| Task | งานย่อย |
| Meeting | task ประเภท `kind=meeting` |
| Connection | ผู้ติดต่อภายนอก |
| Points | คะแนนสะสมจากการทำงาน |
| Phase | ขั้นตอนใน points workflow |
| Leader | หัวหน้าโครงการ |
| Assignee | ผู้รับผิดชอบ task |
| Lobbyist | บุคคลคนกลางที่ประสานงาน |
| Agency | หน่วยงานราชการ |
| iMIP | iCalendar Message-Based Interoperability Protocol (email invite) |
| SSE | Server-Sent Events (push updates) |
| PWA | Progressive Web App |

### C. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2025-12 | Initial spec — basic CRUD |
| 2.0 | 2026-05 | + Boss role, Connection 3 types, Points workflow, Whiteboard, Recording |

---

**End of User Requirements Document**

**ผู้รับผิดชอบ:**
- Product Owner: Team Lead
- Reviewers: Boss, Admin team
- Approvers: Boss

**ใช้คู่กับ:**
- `DESIGN_SPEC.md` — สำหรับทีม Design
- Source code repo — สำหรับทีม Engineering
