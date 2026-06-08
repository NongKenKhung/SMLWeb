# SMLWeb — User Requirements Document (ฉบับละเอียด)

> เอกสารความต้องการระบบฉบับสมบูรณ์ — ครอบคลุม **ทุกหน้า ทุกฟีเจอร์ ทุก popup** พร้อมระบุว่าแต่ละ popup/form ต้องกรอก/แสดงข้อมูลอะไรบ้าง (field, ชนิดข้อมูล, บังคับ/ไม่บังคับ, validation, ใครทำได้)
>
> **Project:** SMLWeb (Smart City Lab Web App) · **Team:** Smart City Lab @ KMITL
> **Version:** 3.0 (detailed) · **Date:** 2026-05-22
> **เอกสารคู่กัน:** `DESIGN_SPEC.md` (UI/UX สำหรับ designer)

---

## สารบัญ

**ส่วน A — ภาพรวม**
1. [บทนำ + วิธีอ่านเอกสาร](#1-บทนำ)
2. [ผู้ใช้ (Personas)](#2-ผู้ใช้-personas)
3. [Feature Inventory — ฟีเจอร์ทั้งหมด](#3-feature-inventory)
4. [Role & Permission Matrix](#4-role--permission-matrix)
5. [Data Dictionary — ฟิลด์ของทุก Entity](#5-data-dictionary)

**ส่วน B — รายละเอียดหน้าจอ**
6. [Login](#6-login)
7. [Home](#7-home)
8. [Tasks / Todo](#8-tasks--todo)
9. [Calendar](#9-calendar)
10. [People (Members + Connections)](#10-people)
11. [Summary](#11-summary)
12. [Overview (Boss)](#12-overview)
13. [Profile](#13-profile)
14. [Whiteboard](#14-whiteboard)
15. [Dev Tools (/dev)](#15-dev-tools)

**ส่วน C — Popup / Modal ทุกตัว (ละเอียดระดับฟิลด์)**
16. [Generic Dialogs (Confirm/Prompt/Toast)](#16-generic-dialogs)
17. [Task Popups](#17-task-popups)
18. [Meeting Popups](#18-meeting-popups)
19. [Group Popups](#19-group-popups)
20. [Member Popups](#20-member-popups)
21. [Connection Popups](#21-connection-popups)
22. [Points Workflow Popups](#22-points-workflow-popups)
23. [Membership Flow Popups](#23-membership-flow-popups)
24. [Poll Popups](#24-poll-popups)
25. [Submission / File Popups](#25-submission--file-popups)
26. [Admin / Settings Popups](#26-admin--settings-popups)
27. [Notification + Preview Sheets](#27-notification--preview-sheets)
28. [Whiteboard Popups](#28-whiteboard-popups)

**ส่วน D — กฎเกณฑ์ + ข้อกำหนด**
29. [Workflows (Points / Group Lifecycle / Invitation)](#29-workflows)
30. [Validation Rules](#30-validation-rules)
31. [Notifications Spec](#31-notifications-spec)
32. [Non-Functional Requirements](#32-non-functional-requirements)
33. [Constraints + Out of Scope](#33-constraints--out-of-scope)
34. [Acceptance Criteria](#34-acceptance-criteria)

---

# ส่วน A — ภาพรวม

## 1. บทนำ

### 1.1 จุดประสงค์
ระบุความต้องการของระบบ SMLWeb ในระดับที่ทีม Dev/Design นำไปสร้างได้ทันที — โดยเฉพาะ **รายละเอียดของทุก popup ว่าต้องมีฟิลด์อะไร บังคับไหม validate อย่างไร**

### 1.2 วิธีอ่านตาราง field ในเอกสารนี้
ทุก popup จะมีตารางในรูปแบบ:

| Field | Type | Req | Validation | Default | คำอธิบาย |
|---|---|:-:|---|---|---|

- **Type:** ชนิด input (text / number / select / textarea / date / datetime / radio / checkbox / chips / file / color)
- **Req:** ✅ = บังคับ, — = ไม่บังคับ
- **Validation:** เงื่อนไขที่ต้องผ่านก่อนบันทึก
- **Default:** ค่าเริ่มต้น

### 1.3 คำศัพท์

| คำ | ความหมาย |
|---|---|
| Member / สมาชิก | ผู้ใช้ที่มี account |
| Group / Project / โครงการ | กลุ่มงานที่รวม task หลายใบ มี leader 1 คน |
| Task / งาน | งานย่อย 1 ใบ |
| Meeting / ประชุม | task ชนิด `kind=meeting` ส่ง email invite |
| Connection | ผู้ติดต่อภายนอก (บริษัท/lobbyist/หน่วยงาน) |
| Points / คะแนน | คะแนนสะสมจากการทำงานเสร็จ |
| Phase | ขั้นตอนใน points workflow |
| Leader / หัวหน้า | ผู้รับผิดชอบโครงการ |
| Assignee | ผู้รับผิดชอบ task |

---

## 2. ผู้ใช้ (Personas)

| Persona | Role | อุปกรณ์ | เป้าหมายหลัก |
|---|---|---|---|
| **อ.อ๊อด** | boss | iPad | ดูภาพรวมทีม, อนุมัติคำขอ |
| **เคน** | admin | laptop + มือถือ | สร้าง/มอบหมายงาน, จัดการระบบ, อนุมัติ |
| **น้องเจน** | member | มือถือ | ทำงาน, ส่งงาน, รับ points |
| **น้องเอม** | member (ใหม่) | มือถือ | รู้จักทีม, หา group เข้าร่วม |

> **หลักสำคัญ:** ทุกหน้าจอ + popup ต้องใช้งานได้บน **มือถือ + iPad + Apple Pencil** — input ≥16px (กัน iOS zoom), tap target ≥44×44px

---

## 3. Feature Inventory

ฟีเจอร์ทั้งหมดในระบบ (รวมที่เพิ่มเข้ามาภายหลัง):

### 3.1 Core
- [F-01] Authentication (ชื่อ + PIN)
- [F-02] Role 3 ระดับ: **boss / admin / member** *(boss เพิ่มภายหลัง — สูงกว่า admin)*
- [F-03] Task CRUD + Kanban + drag-drop เปลี่ยน status
- [F-04] Group (โครงการ) CRUD + leader + members
- [F-05] Meeting + ส่ง iMIP email invite (.ics)
- [F-06] Calendar รวม task + meeting + leave

### 3.2 Workflow
- [F-07] **Points workflow 4 phase** (เสนอเอง → leader → final → confirmed)
- [F-08] Point Request (ขอเพิ่มคะแนนหลัง confirm)
- [F-09] Deadline Request (ขอเลื่อน + อนุมัติ)
- [F-10] **Group lifecycle 9 สถานะ** *(เพิ่มภายหลัง)*: idea → proposal → pending_approval → in_progress → delivery → maintenance → completed (+ on_hold / cancelled)
- [F-11] Group invitation / proposal / claim flow

### 3.3 ข้อมูล + ติดต่อ
- [F-12] **Connection 3 ประเภท** *(ปรับภายหลัง)*: บริษัท / lobbyist / หน่วยงาน
- [F-13] **group_connections** — ผูก connection หลายอันกับ group (many-to-many) *(เพิ่มภายหลัง)*
- [F-14] Category (tag) ของ task + จัดการ inline
- [F-15] Abbreviation search — ค้นด้วยตัวย่อราชการ 878 รายการ

### 3.4 Collaboration
- [F-16] Comments + **@mention** + notification *(เพิ่มภายหลัง)*
- [F-17] File submission + doc_type tagging + URL link
- [F-18] In-app file preview (image/PDF/video/audio/docx/xlsx)
- [F-19] Poll / โหวต (anonymous, multi-choice, expires)
- [F-20] Whiteboard collaborative + Apple Pencil + inject + recorder
- [F-21] Audio recording + AI transcribe + AI summary

### 3.5 ฟีเจอร์เสริม (เพิ่มภายหลัง)
- [F-22] **Overview page** (boss) — จัดการทุก entity ในตารางเดียว
- [F-23] **Multi-select filter** (ติ๊กหลาย status พร้อมกัน) ใน Overview + Todo
- [F-24] **Sort + Filter** ใน Overview / Todo / People
- [F-25] **Soft-delete + Trash** (กู้คืนได้ 30 วัน) สำหรับ task/group
- [F-26] **Custom color picker** กลุ่มงาน (3 tiers อ่อน/กลาง/เข้ม + เลื่อนซ้ายขวา)
- [F-27] Calendar: 3 รายการต่อประเภท + คลิกวัน + "ดูทั้งเดือน"
- [F-28] Notification เรียงใหม่สุดบน
- [F-29] Leave (วันลา) + แสดงในปฏิทิน
- [F-30] Auto group summary (markdown) + regenerate
- [F-31] Export CSV (รองรับชื่อไฟล์ไทย)
- [F-32] Dark mode (Auto/Light/Dark)
- [F-33] PWA + offline + auto-update (service worker)
- [F-34] Budget field + k/m/b shorthand

---

## 4. Role & Permission Matrix

### 4.1 ลำดับสิทธิ์
```
boss (สีทอง)  ≥  admin (สีฟ้า)  >  member (สีเทา)
```
> boss = admin ทุกสิทธิ์ ต่างแค่ label + เห็น Overview แทน Summary
> `hasAdminPerms()` = role เป็น admin หรือ boss

### 4.2 ตารางสิทธิ์ละเอียด

| ความสามารถ | member | admin/boss | group leader | เจ้าของข้อมูล |
|---|:-:|:-:|:-:|:-:|
| ดู task/group/member/connection | ✅ | ✅ | ✅ | ✅ |
| สร้าง/แก้/ลบ task | ❌ | ✅ | ✅ (กลุ่มตน) | — |
| สร้าง group | ❌ | ✅ | — | — |
| แก้ group | ❌ | ✅ | ✅ (ตนนำ) | — |
| ลบ group | ❌ | ✅ | ❌ | — |
| เปลี่ยน leader | ❌ | ✅ | ❌ | — |
| เพิ่ม/ลบ member ในกลุ่ม | ❌ | ✅ | ✅ (ตนนำ) | self ออกเองได้ |
| สร้าง/แก้/ลบ member | ❌ | ✅ | ❌ | self แก้ profile/PIN ตน |
| กำหนด role | ❌ | ✅ | ❌ | ❌ |
| สร้าง/แก้/ลบ connection | self สร้างได้ | ✅ | — | ✅ (เจ้าของ) |
| Confirm points | ❌ | ✅ | ✅ (กลุ่มตน) | — |
| อนุมัติ point/deadline request | ❌ | ✅ | ❌ | — |
| เสนอ points ตัวเอง | ✅ (เป็น assignee) | ✅ | ✅ | — |
| ขอเพิ่ม points / ขอเลื่อน deadline | ✅ | ✅ | ✅ | — |
| สร้าง/โหวต poll | ✅ | ✅ | ✅ | ปิด/ลบ = creator/admin |
| เห็น Overview | ❌ | ✅ (boss) | ❌ | — |
| เห็น Summary | ✅ | ✅ (admin) | ✅ | — |
| เข้า /dev + System Settings | ❌ | ✅ | ❌ | — |
| ลบถาวร (purge trash) | ❌ | ✅ | ❌ | — |

---

## 5. Data Dictionary

ฟิลด์ของทุก entity (อ้างอิง schema จริง) — ใช้เป็นแหล่งความจริงของ validation

### 5.1 Member (สมาชิก)
| Field | Type | Req | Validation | คำอธิบาย |
|---|---|:-:|---|---|
| name | text | ✅ | unique ในระบบ | ชื่อใช้ login |
| role | enum | ✅ | boss/admin/member | สิทธิ์ |
| password (PIN) | text | ✅ (ตอนสร้าง) | ≥4 ตัว, default `1234` | เก็บแบบ bcrypt hash |
| email | email | — | รูปแบบ email | |
| phone | tel | — | | |
| prefix | text | — | | คำนำหน้า (อ./ดร.) — แสดงผลแยก |
| color | color | — | hex, default `#6366f1` | สีประจำตัว/avatar |
| avatar_url | url | — | | รูปโปรไฟล์ |

### 5.2 Task Group (โครงการ)
| Field | Type | Req | Validation | คำอธิบาย |
|---|---|:-:|---|---|
| name | text | ✅ | | ชื่อโครงการ |
| description | textarea | — | markdown | |
| target | text | — | datalist เดิม | หน่วยงานปลายทาง |
| color | color | — | hex, **ไม่ควรซ้ำกลุ่มอื่น** (เตือน) | identity สี |
| leader_id | ref member | — | admin/leader ตั้ง | หัวหน้า 1 คน |
| status | enum | ✅ | 9 สถานะ + archived | lifecycle |
| start_date | date | — | default = วันสร้าง | |
| deadline | date | — | | |
| connection_ids | ref[] | — | many-to-many | connection ที่ผูก |
| deleted_at | timestamp | — | soft-delete | null = active |

### 5.3 Task (งาน)
| Field | Type | Req | Validation | คำอธิบาย |
|---|---|:-:|---|---|
| title | text | ✅ | | |
| description | textarea | — | markdown | |
| kind | enum | ✅ | task / meeting | |
| group_id | ref group | — | | |
| target | text | — | | ใช้เมื่อไม่มี group |
| deadline | date/datetime | ✅* | meeting = datetime | *task ปกติบังคับ |
| start_date | date | — | | |
| end_time | datetime | — | meeting เท่านั้น, ≥ start+? | เวลาจบประชุม |
| location_type | enum | — | online/onsite_internal/onsite_external | meeting |
| location_detail | text/url | — | online → URL | |
| budget | number | — | รับ k/m/b shorthand | งบประมาณ |
| points | number | — | ≥0 | |
| points_phase | enum | — | none/proposing/leader_review/final_review/confirmed | |
| status | enum | ✅ | on_hold/in_progress/completed/cancelled (+lifecycle) | |
| assignee_ids | ref[] | — | | ผู้รับผิดชอบ |
| category_ids | ref[] | — | | tag |
| deleted_at | timestamp | — | soft-delete | |

### 5.4 Task Assignee (ผู้รับผิดชอบ)
| Field | Type | คำอธิบาย |
|---|---|---|
| task_id + member_id | composite key | |
| task_role | enum | leader / member |
| points_share | number | คะแนนที่ได้จาก task นี้ |
| assigned_at | timestamp | วันที่ถูกมอบหมาย |
| proposed_at | timestamp | วันที่เสนอ/เสร็จ (= วันได้ point) |

### 5.5 Connection (ผู้ติดต่อ)
| Field | Type | Req | เงื่อนไขตาม kind | คำอธิบาย |
|---|---|:-:|---|---|
| kind | enum | ✅ | personal/lobbyist/agency | |
| member_id | ref | — | personal/agency = เจ้าของ | |
| company | text | ✅ (personal, agency) | personal=บริษัท, agency=ชื่อหน่วยงาน | ห้ามว่างใน 2 ชนิด |
| liaison_name | text | ✅ (lobbyist, agency) | ชื่อบุคคลผู้ประสาน | |
| contact_name | text | — | personal เท่านั้น | |
| contact_role | text | — | ตำแหน่ง | |
| phone | tel | — | | |
| email | email | — | | |
| topics | text | — | หัวข้อที่เกี่ยวข้อง | |
| notes | textarea | — | | |

### 5.6 Entity อื่น ๆ (สรุป field สำคัญ)
- **Leave:** member_id, start_at (datetime ✅), end_at (datetime ✅), reason
- **Poll:** question ✅, options[] ✅ (≥2), multi_choice (bool), anonymous (bool), expires_at, closed
- **Point Request:** task_id, requested_by, current_points, requested_points (> current), reason, status
- **Deadline Request:** task_id, requested_by, current_deadline, requested_deadline ✅, reason, status
- **Comment:** task_id, member_id, body ✅, mentions[], deleted_at
- **Task File:** task_id, original_name, mimetype, size, doc_type (default 'อื่นๆ'), url (สำหรับ link), label
- **Whiteboard:** name ✅, canvas_json, created_by, visibility
- **Recording:** filename, label, duration_ms, transcript, transcript_status, summary, action_items[]
- **Category:** name ✅ (unique)

---

# ส่วน B — รายละเอียดหน้าจอ

> แต่ละหน้าระบุ: ใช้ทำอะไร · แสดงข้อมูลอะไร · action อะไรได้ · ใครเห็น

## 6. Login

**ใช้ทำอะไร:** เข้าระบบ
**แสดง:** logo, ชื่อแอป, ฟอร์ม login
**ฟิลด์:**
| Field | Type | Req | Validation |
|---|---|:-:|---|
| ชื่อผู้ใช้ | text | ✅ | ตรงกับ member.name |
| PIN | password (numeric) | ✅ | ตรงกับ hash |

**Action:** ปุ่ม "เข้าสู่ระบบ" → ถ้าผิดแสดง error สีแดงใต้ฟอร์ม
**Requirement:** ห้าม self-signup — admin สร้าง account ให้เท่านั้น

---

## 7. Home

**ใช้ทำอะไร:** dashboard ส่วนตัว — "วันนี้ต้องทำอะไร"
**แสดงข้อมูล (เรียงบนลงล่าง):**

1. **Greeting banner** — ชื่อผู้ใช้, role badge, "เสร็จ X · กำลังทำ Y", points รวมของตน
2. **Stats 4 ช่อง** — สมาชิกทั้งหมด / โครงการ / งานเสร็จ / งานเกินกำหนด
3. **ใกล้ถึง Deadline** — task ≤2 วัน (ไม่รวม meeting/cancelled); non-admin เห็นเฉพาะของตน; แสดง: สีกลุ่ม, ชื่องาน, กลุ่ม, assignees, target, deadline (สีตามความด่วน)
4. **ประชุมใกล้ถึง** — meeting ≤2 วัน + location chip (online/onsite) + ลิงก์ (ถ้า online)
5. **กลุ่มที่ยังไม่ได้เข้าร่วม** — leaderless ก่อน, max 6; ปุ่ม "หยิบกลุ่ม"/"เสนอตัว"/"รอพิจารณา"
6. **Scoreboard** — pie + legend (คนที่ points>0)
7. **โพล** — poll ที่เปิดอยู่ max 5 + ปุ่มสร้าง
8. **คำขอเลื่อน Deadline** *(admin/boss เท่านั้น)* — inline อนุมัติ/ปฏิเสธ

---

## 8. Tasks / Todo

**ใช้ทำอะไร:** Kanban จัดการงาน + workflow
**Toolbar:** ค้นหา (รองรับตัวย่อ) + ปุ่ม filter (มี badge นับ)
**Segmented 3 มุมมอง:** งานของฉัน / งานที่ฉันเป็นหัวหน้า (leader) / งานของ Admin (admin)
**Filter sheet:**
- สถานะ — **multi-select chips** (ติ๊กหลายอันได้; ไม่ติ๊ก=ทั้งหมด)
- เรียงตาม — 14 ตัวเลือก (deadline/start/points/group/target/budget/status ทั้ง asc/desc)
- โครงการ (dropdown), Target (dropdown)

**Kanban 4 คอลัมน์:** พักไว้ / กำลังทำ / เสร็จ(รอ confirm) / คอนเฟิร์มแล้ว
- คอลัมน์ Admin column 3 = mixed queue (point requests + deadline requests + group proposals + final_review tasks)
- **drag-drop** เปลี่ยน status; งานจัดกลุ่มตามโครงการ (`<details>`) + sum points

**Task card แสดง:** สีกลุ่ม(border-left), ชื่อ, status badge, points pill, กลุ่ม, target, location chip(meeting), desc 2 บรรทัด, assignees, "ของคุณ", deadline(สีด่วน), phase badge
**Trash bin:** ลาก card มาวาง → ลงถังขยะ (กู้คืน 30 วัน)

---

## 9. Calendar

**ใช้ทำอะไร:** ปฏิทินรวม task + meeting + leave
**Layout:** desktop 70/30 (ปฏิทิน / รายละเอียด)
**Cell แต่ละวัน:** เลขวัน + pills (≤3 ต่อประเภท): 📅meeting / 📋task / 👤leave + overflow "+N"; flag today/selected/overdue
- task แสดงเฉพาะ in_progress; meeting/leave แสดงเสมอ
**ฝั่งขวา:** create bar (admin/leader — preset deadline=วันที่เลือก) + ปุ่ม "ดูทั้งเดือน" + 3 sections (ประชุม/งาน/วันลา)
**Interaction:** คลิกวัน→ดูเฉพาะวัน; คลิกซ้ำ→deselect; auto-scroll วันนี้

---

## 10. People

**Segmented 2:** สมาชิก / Connections

### 10.1 สมาชิก
**Toolbar:** ค้นหา (ชื่อ/email/phone) + sort (points/ชื่อ/role/งาน) + filter (role)
**Card แสดง:** avatar, ชื่อ + "(คุณ)" + badge "🏖️ลา"(ถ้าลาอยู่), role badge, email(tel), phone, ⭐points · X% · งานเสร็จ/ทั้งหมด; admin มี edit/delete
**คลิก card →** Member Detail sheet (ดู §20.4)

### 10.2 Connections
**Toolbar:** ค้นหา (company/contact/phone/email/notes/topics/liaison) + sort + filter (kind)
**3 sections พับได้:**
- 🏢 **บริษัท** — group ตามเจ้าของ member; card: company, contact_name·role, phone/email, notes, **chips กลุ่มที่ใช้**
- 🎯 **Lobbyist** — flat; card: liaison_name, role, contact, notes
- 🏛️ **หน่วยงาน** — group ตาม company; card: liaison_name(role), เบอร์/อีเมล

---

## 11. Summary

**ใช้ทำอะไร:** มุมมอง project-centric (admin/member; boss ใช้ Overview)
**Index:** ปุ่มสร้างโครงการ + 3 sections (ฉันเป็นหัวหน้า/สมาชิก/ไม่เกี่ยวข้อง) + 2 พับได้ (archived/completed)
**Group card:** สีกลุ่ม, ชื่อ, leader, desc, 3 stat (tasks done/total · points · files), progress bar, start/deadline, connection chips, ปุ่ม (หยิบ/เสนอตัว/แก้/archive/ลบ)
**Detail:** hero(สีกลุ่ม) + 3 stat + join CTA + connections(by kind) + members(leader ทอง) + tasks + files + **auto summary (markdown) + regenerate/download** + Export CSV

---

## 12. Overview

**ใช้ทำอะไร:** Admin/Boss console — จัดการทุก entity (boss เห็นแทน Summary)
**Toolbar:** ค้นหารวมทุก entity (รองรับตัวย่อ) + 5 tabs (All/Tasks/Groups/Members/Connections) + counter
**ทุก tab = ตาราง + sort + multi-select filter + CRUD inline**

| Tab | คอลัมน์ | Sort | Filter |
|---|---|---|---|
| Tasks | ชื่อ+กลุ่ม, status, deadline, assignees, budget, จัดการ | deadline/title/points/status | status(multi) + group(multi) |
| Groups | ชื่อ+target, status, leader, จำนวน task, deadline, จัดการ | created/name/status/deadline | status(multi 9 ค่า) |
| Members | avatar+ชื่อ, role, email, จำนวนงาน, points, จัดการ | role/points/ชื่อ | role + group(multi) |
| Connections | ชื่อ(ตาม kind), kind, phone, email, "โดย", จัดการ | name/kind | kind |

> **ข้อกำหนดสำคัญ:** Overview ต้อง **เข้าใจง่ายที่สุด** — ทุกคนเปิดมาต้องรู้ว่ากดอะไรได้ ค้นหาตรงไหน

---

## 13. Profile

**แสดง:** avatar(แก้ได้) + ชื่อ + role + email; stats (points/เสร็จ/กำลังทำ/ทั้งหมด); theme toggle (Auto/Light/Dark)
**Settings list (เปิด popup):** เปลี่ยน PIN / จัดการวันลา / จัดการ Task Groups(admin/leader) / คำขอเลื่อน Deadline / ถังขยะ / ตั้งค่าระบบ(admin) / Dev Tools(admin) / ออกจากระบบ

---

## 14. Whiteboard

**ใช้ทำอะไร:** กระดานวาด collaborative + Apple Pencil + จดประชุม
**List view:** รายการ board + สร้างใหม่
**Canvas:** เครื่องมือ (select/lasso/pan, draw/highlight/eraser, shapes, text/sticky/image, color/stroke/fill, undo/redo, zoom, paper type/size, fullscreen, inject, record, export PNG, delete)
**Real-time:** multi-user cursor + auto-save 1.5 วินาที
**Inject:** ดึง task/group/meeting/points จากระบบมาวางบน canvas
**Recorder:** อัดเสียงขณะวาด (ลอยไม่บล็อก canvas)

---

## 15. Dev Tools (/dev)

**เข้าได้:** admin/boss เท่านั้น (auth gate)
**13 panels:** API Playground · Data Explorer · System Info · Whiteboard · Component Lab · Room Designer · About Editor · Files Browser · **Point Ledger (table + Gantt)** · Activity Log (SSE) · Dev Notes · Settings · Members(read-only)

---

# ส่วน C — Popup / Modal ทุกตัว (ละเอียดระดับฟิลด์)

> **นี่คือส่วนหลักของเอกสาร** — ทุก popup ระบุ: เปิดเมื่อไหร่ · ใครเปิดได้ · ฟิลด์ครบ · ปุ่ม · บันทึกแล้วเกิดอะไร

## 16. Generic Dialogs

### 16.1 Confirm Dialog (`uiConfirm`)
**ใช้เมื่อ:** ต้องยืนยันก่อนทำ (ลบ, ยกเลิก, reopen)
**แสดง:** หัวเรื่อง + ข้อความ + ปุ่ม [ยกเลิก] [ยืนยัน]
**Requirement:** ปุ่มยืนยันสีแดงเมื่อเป็น destructive; Enter=ยืนยัน, Esc=ยกเลิก

### 16.2 Prompt Dialog (`uiPrompt`)
**ใช้เมื่อ:** ขอข้อความสั้น (ชื่อ category, label)
**ฟิลด์:** 1 text input + ปุ่ม [ยกเลิก] [ตกลง]

### 16.3 Toast
**ใช้เมื่อ:** feedback หลัง action (บันทึกแล้ว/ผิดพลาด) — auto หาย, ไม่บล็อก

---

## 17. Task Popups

### 17.1 Create Task Flow (`openCreateTaskFlow`)
**เปิดเมื่อ:** กด "+" ในหน้า Todo · **ใคร:** admin/leader
**แสดง:** เลือกกลุ่มก่อน (admin เห็นทุกกลุ่ม, leader เห็นเฉพาะที่ตนนำ) + "สร้างกลุ่มใหม่" + (admin) "งานเดี่ยวไม่อยู่ในกลุ่ม"
**ไปต่อ:** เปิด Multi-Task modal ของกลุ่มที่เลือก

### 17.2 Create/Edit Task (`openTaskModal` / `openTaskEdit`)
**เปิดเมื่อ:** สร้าง/แก้ task · **ใคร:** admin หรือ leader ของกลุ่มนั้น

| Field | Type | Req | Validation | Default | คำอธิบาย |
|---|---|:-:|---|---|---|
| title | text | ✅ | ไม่ว่าง | | ชื่องาน |
| description | textarea | — | markdown | | |
| group_id | select | — | + ปุ่ม "สร้างกลุ่มใหม่" | | ผูกโครงการ |
| target | text + datalist | — | | | ใช้เมื่อไม่มี group |
| deadline | date (flatpickr) | ✅ | dd/mm/yyyy | | กำหนดส่ง |
| budget | text | — | parse k/m/b → number | | งบประมาณ |
| categories | chips | — | + เพิ่ม/แก้/ลบ inline | | tag |
| assignees | chips grid | — | "เลือกทุกคน" toggle | | กรองตาม group |
| status | select | — | on_hold/in_progress/completed/cancelled | on_hold | |

**ปุ่ม (edit mode เพิ่ม):** ⭐แบ่ง Points · 👥จัดการผู้รับผิดชอบ · ⏰ขอเลื่อน Deadline
**บันทึก:** POST/PUT → ปิด modal → assignees ได้ notification

### 17.3 Multi-Task Create (`openMultiTaskModal`)
**เปิดเมื่อ:** สร้างหลายงานในกลุ่มเดียว · **ใคร:** admin/leader
**ต่อแถว:** title ✅ / description / deadline ✅ / budget / category dropdown / assignees chips
**ปุ่ม:** "เพิ่มประเภทงานใหม่" (category) · "เพิ่มอีก" (แถว) · ✕ลบแถว
**บันทึก:** POST ทีละแถว

### 17.4 Task Detail Sheet (`openTaskSheet`)
**เปิดเมื่อ:** คลิก task card · **ใคร:** ทุกคน
**แสดง:** ชื่อ + status/phase badge + กลุ่ม/target/budget/points + (meeting) location card + desc(markdown) + category tags + วันที่ (task=เริ่ม+deadline, meeting=วันเวลานัด) + รายชื่อ assignees(+points_share) + comments thread
**ปุ่ม:** 📎ส่งงาน/ดูไฟล์ · ⭐ปุ่ม points (เปลี่ยนชื่อตาม phase) · (meeting)📧ส่งเชิญอีกครั้ง · ✏️แก้ · 🗑ลบ(soft→trash)
**Comments:** textarea + @mention autocomplete; ผู้ tag ได้ notification

---

## 18. Meeting Popups

### 18.1 Create/Edit Meeting (`openMeetingModal` / `openMeetingEdit`)
**เปิดเมื่อ:** สร้าง/แก้ประชุม · **ใคร:** admin/leader

| Field | Type | Req | Validation | คำอธิบาย |
|---|---|:-:|---|---|
| title | text | ✅ | | หัวข้อประชุม |
| description | textarea | — | markdown | วาระ |
| location_type | radio (3) | — | online/onsite_internal/onsite_external | |
| location_detail | text/url | — (✅ ถ้า online ควรมี URL) | online=URL คลิกได้ | |
| group_id | select | — | + "ประชุมรวม Lab" (cross-group) | |
| deadline (start) | datetime | ✅ | dd/mm/yyyy HH:mm | เวลาเริ่ม |
| end_time | datetime | — | ≥ start (auto-bound start+60min) | เวลาจบ |
| attendees | chips grid | — | "เลือกทุกคน" | ผู้เข้าร่วม |
| ส่งอีเมลเชิญ | (auto) | — | ตาม system setting | iMIP .ics |

**บันทึก:** POST/PUT → ถ้าเปิด email → ส่ง .ics ให้ attendees; **ลบประชุม → ส่ง CANCEL email อัตโนมัติ** (confirm ก่อน)
**Edit mode เพิ่ม:** 👥จัดการผู้เข้าร่วม

---

## 19. Group Popups

### 19.1 Create/Edit Group (`openGroupModal`)
**เปิดเมื่อ:** สร้าง/แก้โครงการ · **ใคร:** admin (แก้ได้ทั้ง leader ตนเอง)

| Field | Type | Req | Validation | คำอธิบาย |
|---|---|:-:|---|---|
| name | text | ✅ | ไม่ว่าง | ชื่อโครงการ |
| description | textarea | — | markdown | |
| target | text + datalist | — | | หน่วยงานหลัก |
| **color** | composite | — | hex `^#[0-9a-f]{6}$`; **เตือนถ้าซ้ำกลุ่มอื่น** | native + hex + palette 3 tiers (อ่อน/กลาง/เข้ม) เลื่อน `<` `>` + จุดบอกหน้า |
| leader_id | select | — | edit mode / admin | หัวหน้า |
| members | chips grid | — | create mode; คนแรก=leader(👑); "เลือกทุกคน" | |
| connection_ids | multi-select 3 sections | — | บริษัท/lobbyist/หน่วยงาน | ผูก connection |
| status | select | ✅ | 9 lifecycle statuses | |

**บันทึก:** POST/PUT; create แปลง assignee→member_ids, connection_ids string→array

### 19.2 Group List Manager (`openGroupListModal`)
**เปิดเมื่อ:** Profile → จัดการ Task Groups · **ใคร:** admin/leader
**แสดง:** card ต่อกลุ่ม (leader, desc, start/deadline, progress) + แก้/ลบ(admin) + "เพิ่มโครงการใหม่"

---

## 20. Member Popups

### 20.1 Create/Edit Member (`openMemberModal`)
**เปิดเมื่อ:** People/Overview → เพิ่ม/แก้สมาชิก · **ใคร:** admin เท่านั้น

| Field | Type | Req | Validation | Default | คำอธิบาย |
|---|---|:-:|---|---|---|
| name | text | ✅ | unique | | ชื่อ login |
| role | select | ✅ | boss/admin/member | member | |
| email | email | — | รูปแบบ email | | |
| phone | tel | — | | | |
| prefix | text | — | | | คำนำหน้า |
| color | color | — | hex | #6366f1 | |
| password | password | ✅(สร้าง) | ≥4 | `1234` | PIN เริ่มต้น |

> **ข้อจำกัดความปลอดภัย:** ระบบ/แอดมินไม่กรอก PIN ของผู้ใช้แทน — ผู้ใช้เปลี่ยน PIN เองภายหลัง

### 20.2 Change PIN
**เปิดเมื่อ:** Profile → เปลี่ยน PIN · **ใคร:** ทุกคน (ของตน)
| Field | Type | Req | Validation |
|---|---|:-:|---|
| current_password | password | ✅ | ตรงกับปัจจุบัน |
| new_password | password | ✅ | ≥4 ตัว |

### 20.3 Avatar Upload
**เปิดเมื่อ:** Profile → 📷 · **ใคร:** ทุกคน
**Flow:** เลือกรูป → resize 384px WebP ~85% → POST; ลบ → confirm → DELETE

### 20.4 Member Detail Sheet (`openMemberDetail`)
**เปิดเมื่อ:** คลิก member card · **ใคร:** ทุกคน
**แสดง:** avatar+email(mailto)+phone(tel); 3 stat (points/เสร็จ/อัตราสำเร็จ); leave banner; วันลาที่จะถึง; **radar 6 แกน** (เอกสาร/ศิลป์/Extrovert/Participation/ม้าเร็ว/Dev); งาน 3 กลุ่ม (กำลังทำ/พักไว้/เสร็จ)

---

## 21. Connection Popups

### 21.1 Create/Edit Connection (`openConnectionModal`)
**เปิดเมื่อ:** People → เพิ่ม/แก้ connection · **ใคร:** เจ้าของ หรือ admin
**Kind radio (เปลี่ยนฟิลด์ที่แสดง):** 🏢บริษัท(personal) / 🎯Lobbyist / 🏛️หน่วยงาน(agency)

| Field | personal | lobbyist | agency | Validation |
|---|:-:|:-:|:-:|---|
| member_id (เจ้าของ) | ✅(admin เลือก) | ซ่อน | auto=ตัวเอง | |
| company | ✅ บริษัท | ซ่อน | ✅ ชื่อหน่วยงาน | ห้ามว่าง |
| liaison_name | ซ่อน | ✅ | ✅ ผู้ประสาน | ห้ามว่าง |
| contact_name | ✅ | ซ่อน | ซ่อน | |
| contact_role | — | — | — | ตำแหน่ง |
| phone | — | — | — | |
| email | — | — | — | |
| topics | — | — | — | |
| notes | — | — | — | |

> **ข้อกำหนด:** ฟิลด์ที่ซ่อนต้อง **disable** ด้วย (กัน 2 ช่องชื่อ company ชนกัน → ส่งค่าผิด)
> ตัวอย่าง: หน่วยงาน = "อบต. → พี่ตู่(กองช่าง), พี่แหม่ม(ปลัด)" (1 หน่วยงาน หลาย liaison)

---

## 22. Points Workflow Popups

### 22.1 Quick Self-Propose (`promptOwnPointsIfNeeded`)
**เปิดเมื่อ:** task เพิ่งเสร็จ (ส่งไฟล์แรก) + เป็น assignee ที่ยังไม่เสนอ
**ฟิลด์:** my_points (number ✅, autofocus) + banner ชื่องาน
**บันทึก:** POST propose-own → phase=proposing

### 22.2 Allocate Points (`openAllocateModal`)
**เปิดเมื่อ:** จัดการ points ของ task · **ใคร:** ตาม phase
**แสดง:** banner phase (4 สี) + ต่อ assignee: avatar, ชื่อ, role, สถานะ("กำหนดแล้ว/รอ"), ช่อง points (แก้ได้ตาม phase) + total สด

| Phase | ใครแก้ได้ | ปุ่ม | API |
|---|---|---|---|
| proposing 🟦 | assignee (ของตน) | บันทึก Point ของฉัน | propose-own |
| leader_review 🟨 | leader/admin | อนุมัติ — ส่งเข้าที่ประชุม | leader-approve |
| final_review 🟪 | leader/admin | ยืนยัน + แจกให้สมาชิก | confirm |
| confirmed ✅ | locked | เปิดแก้ไขอีกครั้ง (confirm) | reopen |

**confirmed เพิ่ม:** ช่องขอเพิ่ม points → req-points-new (number, > ปัจจุบัน) + reason → POST points-request

### 22.3 Request Extension (`openRequestExtensionModal`)
**เปิดเมื่อ:** ทำงานไม่ทัน · **ใคร:** assignee/leader
| Field | Type | Req | คำอธิบาย |
|---|---|:-:|---|
| (แสดง deadline ปัจจุบัน) | — | — | อ้างอิง |
| requested_deadline | date | ✅ | วันใหม่ |
| reason | textarea | — | เหตุผล (กันขอพร่ำเพรื่อ) |

---

## 23. Membership Flow Popups

### 23.1 Assign Task (`openAssignTaskModal`)
**เปิดเมื่อ:** เพิ่มผู้รับผิดชอบ task · **ใคร:** admin/leader
**ฟิลด์:** select member (เฉพาะคนในกลุ่มที่ยังไม่ได้รับมอบหมาย) → POST assignees

### 23.2 Invite to Group (`openInviteToGroupModal`)
**เปิดเมื่อ:** เชิญเข้ากลุ่ม · **ใคร:** admin/leader
**ฟิลด์:** member chips (multi) + "เลือกทุกคน" → POST add-member ต่อคน

### 23.3 Propose to Group (`openProposeGroupModal`)
**เปิดเมื่อ:** member เสนอตัวเข้ากลุ่ม leaderless
**ฟิลด์:** message (textarea, optional) → POST propose → leader/admin พิจารณา

---

## 24. Poll Popups

### 24.1 Create Poll (`openCreatePollModal`)
**ใคร:** ทุกคน
| Field | Type | Req | Validation |
|---|---|:-:|---|
| question | textarea | ✅ | ไม่ว่าง |
| options[] | text dynamic | ✅ | ≥2 ตัวเลือก + "เพิ่มตัวเลือก" |
| multi_choice | checkbox | — | เลือกได้หลายข้อ |
| anonymous | checkbox | — | ไม่เก็บ voter id |
| expires_at | datetime | — | auto-close เมื่อถึง |

### 24.2 Vote / View (`openPollModal`)
**แสดง:** คำถาม + options (radio/checkbox ตาม multi) + result bar (หลังโหวต) + จำนวนโหวต
**ปุ่ม:** โหวต/เปลี่ยนคำตอบ · ปิดโพล(creator/admin) · ลบ(creator/admin)
**Privacy:** anonymous → ไม่แสดง/เก็บว่าใครโหวต

---

## 25. Submission / File Popups

### 25.1 Submission Sheet (`openSubmissionSheet`)
**เปิดเมื่อ:** ส่งงาน · **ใคร:** assignee
**ส่วนประกอบ:**
- Drop zone (drag-drop / เลือกไฟล์ multiple)
- รายการไฟล์ staged — ต่อไฟล์: ชื่อ, ขนาด, **dropdown doc_type**, ✕ลบ
- ปุ่ม "ล้างทั้งหมด" / "ส่ง"
- ส่วน URL link: url + label + "เพิ่มลิงก์"
- รายการไฟล์ที่ส่งแล้ว (preview/download/delete)
**Auto:** ส่งไฟล์แรก → task=completed → prompt own points

### 25.2 Doc Type Picker (`openDocTypePicker`)
**เปิดเมื่อ:** เลือกประเภทเอกสารของไฟล์
**แสดง:** list doc_type (TOR/Quotation/MoU/อื่นๆ ...) ✓ ตัวที่เลือก

### 25.3 File Preview (`openPreview`)
**แสดงตามชนิด:** image / PDF(iframe) / video / audio / text / docx / xlsx(แท็บ sheet) / pptx(download)
**ปุ่ม:** ดาวน์โหลด *(ต้องขออนุญาตผู้ใช้ก่อน download)*

---

## 26. Admin / Settings Popups

### 26.1 Trash (`openTrashModal`)
**ใคร:** ทุกคน (ลบถาวร=admin)
**3 sections:** 📁โครงการ / 📋งาน / 📅ประชุม (group ย่อยตามกลุ่ม)
**ต่อรายการ:** ชื่อ + เวลาที่ลบ + ↩คืน + 🗑️ลบถาวร(admin, confirm)
**Group restore → คืน task ภายในด้วย (cascade)**

### 26.2 My Leaves (`openMyLeavesModal`)
**ใคร:** ทุกคน (ของตน)
**แสดง:** ประวัติลา (ล่าสุดบน, badge "กำลังลา") + ✕ลบ
**ฟอร์มเพิ่ม:** start_at (datetime ✅) / end_at (datetime ✅) / reason → ขึ้นปฏิทินทีม

### 26.3 Extension Requests (`openExtensionsModal`)
**แสดง:** list คำขอ (งาน, ผู้ขอ, เดิม→ใหม่, เหตุผล, status); admin มีปุ่มอนุมัติ/ปฏิเสธ

### 26.4 System Settings (`openSystemSettingsModal`)
**ใคร:** admin
**แสดง:** สถานะ SMTP (configured/missing) + toggle `email_invitations_enabled`

---

## 27. Notification + Preview Sheets

### 27.1 Notifications (`openNotifications`)
**เปิดเมื่อ:** คลิก 🔔 · **เรียงใหม่สุดบน**
**รวม 10 แหล่ง:**
1. ⚠️ งานของฉันเกินกำหนด
2. ⏰ ครบกำหนดวันนี้/≤3 วัน
3. 🪪 งานยังไม่มีคนรับในกลุ่มที่ฉันนำ
4. ⏰ คำขอเลื่อน deadline รออนุมัติ (admin)
5. 💎 คำขอเพิ่ม points รออนุมัติ (admin)
6. ✅/❌ คำขอของฉันถูกตัดสิน
7. 📩 คำเชิญเข้ากลุ่มถึงฉัน
8. 📩 คำเสนอตัวเข้ากลุ่มที่ฉันนำ
9. ✅/❌ คำเชิญที่ฉันส่งถูกตัดสิน
10. 💬 มีคน @mention ฉัน (preview 80 ตัว)

**ต่อรายการ:** icon + ข้อความ + เวลา; บางอันมีปุ่ม inline (รับ/ปฏิเสธ คำเชิญ, อนุมัติ/ปฏิเสธ point request); คลิกแถว→ไปหน้าเกี่ยวข้อง
**Badge:** นับ unread บน 🔔 (สูงสุด "99+")

---

## 28. Whiteboard Popups

### 28.1 Inject Modal
**Tabs:** 📋งาน / 📁โครงการ / 📅ประชุม / ⭐Points
**แสดง:** ค้นหา + list + "สร้างใหม่"; Points tab = อนุมัติ/ปฏิเสธ point request inline
**คลิก →** วาง card บน canvas

### 28.2 Paper Size Popover
**ตัวเลือก:** A4/A3/A5(ตั้ง/นอน) / Letter / Tabloid / ∞ไม่จำกัด

### 28.3 New Board / Color Picker
- New board: ขอชื่อ
- Color: 8 สีด่วน + recent 6 + custom + stroke size + fill toggle

---

# ส่วน D — กฎเกณฑ์ + ข้อกำหนด

## 29. Workflows

### 29.1 Points Workflow (4 phase)
```
[งานเสร็จ] → proposing (assignee เสนอเอง)
           → leader_review (leader ปรับ+อนุมัติ)
           → final_review (admin ทบทวน)
           → confirmed (แจก points, ล็อก)
                ↑ reopen (admin/leader) ถ้าผิด
                ↓ point-request (member ขอเพิ่ม → admin ตัดสิน)
```
**เหตุผล:** เสนอเองก่อน = ลด bias, leader ปรับให้แฟร์, admin ทบทวนรอบสุดท้าย

### 29.2 Group Lifecycle (9 สถานะ)
```
idea → proposal → pending_approval → in_progress → delivery → maintenance → completed
                                          ↓                            ↑
                                       on_hold                     archived
                                       cancelled (→ trash)
```

### 29.3 Invitation Flow
- **invite:** admin/leader เชิญ → member รับ/ปฏิเสธ
- **proposal:** member เสนอตัว (กลุ่ม leaderless) → leader/admin พิจารณา
- **claim:** admin/leader หยิบกลุ่ม leaderless เป็น leader

---

## 30. Validation Rules

| จุด | กฎ |
|---|---|
| Task title / Group name / Poll question | ห้ามว่าง |
| Task deadline (ปกติ) | บังคับ |
| Meeting | ต้องมี start datetime; end ≥ start |
| Connection | personal/agency ต้องมี company; lobbyist/agency ต้องมี liaison_name |
| Connection (ฟิลด์ซ่อน) | ต้อง disable เพื่อกัน name ชนกัน |
| PIN | ≥4 ตัว |
| Point request | requested_points > current_points |
| Poll | ≥2 options |
| Budget | parse k/m/b เป็นตัวเลข |
| Group color | hex 6 หลัก; เตือนถ้าซ้ำกลุ่มอื่น |
| Email/Phone | รูปแบบถูกต้อง (ถ้ากรอก) |
| ไฟล์อัปโหลด | แสดงชนิด/ขนาด; ต้องขออนุญาตก่อน download |

---

## 31. Notifications Spec

| Trigger | ผู้รับ | ช่องทาง |
|---|---|---|
| @mention ใน comment | คนที่ถูก tag | in-app เท่านั้น (ไม่ส่ง email) |
| สร้าง meeting (email เปิด) | attendees | email iMIP (.ics) |
| ลบ meeting | attendees | email CANCEL |
| point/deadline request | admin | in-app (bell + Todo admin) |
| request ถูกตัดสิน | ผู้ขอ | in-app |
| invite/proposal | ผู้เกี่ยวข้อง | in-app |
| งานใกล้/เกิน deadline | assignee | in-app |

---

## 32. Non-Functional Requirements

| ด้าน | ข้อกำหนด |
|---|---|
| **Performance** | โหลดหน้าแรก <3s; API CRUD <500ms; search <200ms; drag-drop optimistic <100ms |
| **Mobile/iPad/Pencil** | input ≥16px (กัน iOS zoom), tap ≥44px, palm rejection บน canvas, รองรับ Apple Pencil |
| **Offline (PWA)** | service worker; HTML network-first; CSS/JS stale-while-revalidate; ใช้ cached เมื่อ offline |
| **Update** | bump cache version → auto-reload ทุก client |
| **Real-time** | SSE `/api/events` push; whiteboard WebSocket cursor |
| **Security** | JWT bearer; PIN bcrypt; role + ownership check ทุก write; ไม่กรอก PIN แทนผู้ใช้ |
| **Localization** | ไทยหลัก; dd/mm/yyyy + 24h; abbreviation search; Thai filename (RFC 5987) |
| **Data safety** | soft-delete 30 วัน; group restore cascade; audit log ทุก admin action |
| **Theme** | Auto/Light/Dark (ตาม OS หรือเลือกเอง) |
| **A11y** | tap target, contrast, emoji + ข้อความควบคู่ (ไม่ใช้ emoji ลำพัง) |

---

## 33. Constraints + Out of Scope

### 33.1 Constraints
- มือถือเป็นหลัก; iPad portrait=bottom tabbar, desktop≥1024=top nav
- ทุกครั้งที่แก้ → ต้อง deploy ใหม่ (bump SW)
- Stack: Node + PostgreSQL + Vanilla JS + Tailwind; Docker compose
- ทีมเล็ก (<50 คน), self-host, งบจำกัด

### 33.2 Out of Scope (ไม่ทำ)
- Self-signup, social login (Google/MS)
- Mobile native app (ใช้ PWA)
- Video conferencing ในตัว (ใช้ Zoom/Meet ภายนอก)
- Payment / billing
- Multi-tenant (lab เดียว)
- i18n (ไทยอย่างเดียว)
- Calendar sync ภายนอก (Google/Outlook)

---

## 34. Acceptance Criteria

### 34.1 เกณฑ์รวม
- ✅ ทุก persona ทำงานหลักของตัวเองครบ
- ✅ ทุก popup มีฟิลด์ + validation ตามตารางในเอกสารนี้
- ✅ ฟิลด์บังคับว่าง → บล็อก submit + แสดง error inline
- ✅ ทำงานได้บนมือถือ/iPad/Pencil
- ✅ ไม่มี data loss ใน 30 วัน (trash)
- ✅ role ที่ไม่มีสิทธิ์ → ไม่เห็นปุ่ม + API ตอบ 403

### 34.2 ตัวอย่าง (Given/When/Then)

**Create Task**
> Given admin/leader เปิด Create Task
> When เว้น title ว่างแล้วกดบันทึก
> Then บล็อก + ไฮไลต์ title; เมื่อกรอกครบ → POST → card ขึ้น Kanban + assignees ได้ noti

**Connection kind switch**
> Given เปิด Create Connection เลือก kind=lobbyist
> Then ซ่อน+disable company/contact_name; แสดง liaison_name (บังคับ)
> When สลับเป็น personal → แสดง company(บังคับ)+contact_name, ซ่อน liaison_name

**Points confirm**
> Given task อยู่ final_review, ผู้ใช้เป็น leader/admin
> When กดยืนยัน → points_phase=confirmed, points_share แจกเข้าแต่ละ assignee, ล็อกแก้ไข
> And member เห็นปุ่ม "ขอเพิ่ม Points" (req > current)

**Meeting cancel email**
> Given meeting มี attendees + email เปิด
> When ลบ meeting (ยืนยัน) → ส่ง CANCEL email ให้ทุก attendee + ลง trash

---

## ภาคผนวก — Change Log ฟีเจอร์ที่เพิ่ม

| รุ่น | เพิ่ม |
|---|---|
| 1.0 | Core CRUD: member/group/task/meeting/calendar |
| 2.0 | boss role, connection 3 ประเภท, points 4-phase, group lifecycle 9 สถานะ, whiteboard, recording, overview, multi-filter, trash, color picker, @mention, leave, dark mode |
| 3.0 (เอกสารนี้) | รายละเอียดระดับฟิลด์ของทุก popup + validation + workflow |

**ใช้คู่กับ:** `DESIGN_SPEC.md` (UI/UX)

**— จบเอกสาร —**
