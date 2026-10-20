-- Presentation records for the local database. Safe to run more than once.
-- npx.cmd wrangler d1 execute srhr-rams-db --local --file=scripts/seed-presentation.sql

PRAGMA foreign_keys=ON;

DELETE FROM document_extracts WHERE request_id LIKE 'demo-%';
DELETE FROM documents WHERE request_id LIKE 'demo-%';
DELETE FROM receipts WHERE request_id LIKE 'demo-%';
DELETE FROM disbursements WHERE request_id LIKE 'demo-%';
DELETE FROM deliverables WHERE request_id LIKE 'demo-%';
DELETE FROM request_events WHERE request_id LIKE 'demo-%';
DELETE FROM budget_lines WHERE request_id LIKE 'demo-%';
DELETE FROM concept_notes WHERE request_id LIKE 'demo-%';
DELETE FROM notifications WHERE request_id LIKE 'demo-%';
DELETE FROM audit_log WHERE request_id LIKE 'demo-%';
DELETE FROM requests WHERE id LIKE 'demo-%';

INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-01','SRHR-2026-010001','Youth clinic outreach, Bo','Operational','Directorate of Reproductive and Child Health','Directorate User','Community sessions for adolescent SRHR services in Bo district.','2.1.04',18500,822.22,'Bo','Session report and attendance','20 Oct 2026 - 31 Oct 2026','Draft','Directorate','',u.id,'2026-10-18T09:00:00.000Z','2026-10-18T09:00:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,NULL,NULL,NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-02','SRHR-2026-010002','Facility assessment query','Operational','Directorate of Policy, Planning and Information','Directorate User','Supportive supervision returned for a clearer budget note.','6.2.19',42000,1866.67,'Nationwide','Revised budget note','01 Oct 2026 - 20 Oct 2026','Query Raised','Directorate','Please split DSA from transport before this is cleared.',u.id,'2026-10-12T08:30:00.000Z','2026-10-17T11:00:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,'2026-10-12T10:00:00.000Z',NULL,NULL,2 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-03','SRHR-2026-010003','Hospital secretaries supervision','Operational','Directorate of Hospital and Ambulances Service','Directorate User','Administrative supportive supervision for hospital secretaries.','6.2.19',168000,7466.67,'Nationwide','Supervision report','20 Sep 2026 - 04 Oct 2026','Submitted','Project Secretary','',u.id,'2026-10-16T08:00:00.000Z','2026-10-16T08:10:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,'2026-10-16T08:10:00.000Z',NULL,NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-04','SRHR-2026-010004','Family planning commodity review','Procurement','National Medical Supplies Agency','Directorate User','Review of family planning commodity specifications before purchase.','4.3.02',96000,4266.67,'Freetown','Reviewed specifications','15 Oct 2026 - 30 Oct 2026','Submitted','Project Secretary','',u.id,'2026-10-19T14:00:00.000Z','2026-10-19T14:20:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,'2026-10-19T14:20:00.000Z',NULL,NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-05','SRHR-2026-010005','Midwife mentorship, Kenema','Operational','Directorate of Reproductive and Child Health','Directorate User','On-site mentorship for midwives in Kenema.','3.1.11',54000,2400,'Kenema','Mentorship report','01 Nov 2026 - 15 Nov 2026','Awaiting Approval','Chairman','Cleared for the Chairman.',u.id,'2026-10-14T09:00:00.000Z','2026-10-15T16:00:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,'2026-10-14T09:30:00.000Z',NULL,NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-06','SRHR-2026-010006','Ambulance referral drill','Operational','National Emergency Medical Services','Directorate User','Referral drill with hospital and ambulance teams.','5.4.08',27500,1222.22,'Makeni','Drill report','05 Nov 2026','Awaiting Approval','Chairman','Cleared for the Chairman.',u.id,'2026-10-15T10:00:00.000Z','2026-10-16T12:00:00.000Z','SRHR Project','2026',NULL,22.5,'active',0,'2026-10-15T10:20:00.000Z',NULL,NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-07','SRHR-2026-010007','District SRHR coordination meeting','Operational','Directorate of Primary Health Care','Directorate User','Quarterly coordination meeting for district SRHR focal persons.','1.2.06',31000,1377.78,'Bo','Meeting minutes','22 Oct 2026','Approved','IHPAU / Finance','Approved for disbursement.',u.id,'2026-10-10T09:00:00.000Z','2026-10-13T15:00:00.000Z','SRHR Project','2026',31000,22.5,'active',0,'2026-10-10T09:20:00.000Z','2026-10-13T15:00:00.000Z',NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-08','SRHR-2026-010008','Training of trainers, Makeni','Operational','College of Medicine and Allied Health Sciences','Directorate User','Training of trainers for adolescent-friendly services.','2.4.01',72000,3200,'Makeni','Training report','06 Oct 2026 - 10 Oct 2026','Payment Processing','IHPAU / Finance','First tranche sent.',u.id,'2026-10-02T09:00:00.000Z','2026-10-08T11:00:00.000Z','SRHR Project','2026',72000,22.5,'active',0,'2026-10-02T09:30:00.000Z','2026-10-04T10:00:00.000Z',NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-09','SRHR-2026-010009','Community dialogue series','Operational','Gender','Directorate User','Community dialogues on SRHR rights and services.','2.2.15',24000,1066.67,'Port Loko','Dialogue notes','01 Sep 2026 - 30 Sep 2026','Awaiting Receipts','IHPAU / Finance','Full amount disbursed. Receipt still pending.',u.id,'2026-09-01T09:00:00.000Z','2026-10-11T09:00:00.000Z','SRHR Project','2026',24000,22.5,'active',0,'2026-09-01T09:30:00.000Z','2026-09-03T10:00:00.000Z',NULL,1 FROM users u WHERE u.username='directorate';
INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,activity_code,amount_nle,amount_usd,location,deliverable,timeline,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,archival_status,legal_hold,submitted_at,approved_at,closed_at,version)
SELECT 'demo-10','SRHR-2026-010010','School health club launch','Operational','Directorate of Reproductive and Child Health','Directorate User','Launch of school health clubs in Western Area.','2.1.18',15000,666.67,'Western Area','Launch report and receipts','01 Aug 2026 - 20 Aug 2026','Closed','Closed','Closed after verified receipts matched the disbursement.',u.id,'2026-08-01T09:00:00.000Z','2026-09-20T16:00:00.000Z','SRHR Project','2026',15000,22.5,'active',0,'2026-08-01T09:30:00.000Z','2026-08-03T10:00:00.000Z','2026-09-20T16:00:00.000Z',1 FROM users u WHERE u.username='directorate';

INSERT INTO budget_lines(request_id,description,quantity,unit_cost,total) VALUES
('demo-01','Facilitation',4,2500,10000),
('demo-01','Local transport',1,8500,8500),
('demo-03','Senior staff DSA',10,9800,98000),
('demo-03','Junior staff DSA',5,7000,35000),
('demo-03','Drivers DSA',5,7000,35000),
('demo-05','Mentor DSA and venue',6,9000,54000),
('demo-07','Meeting package',40,775,31000);

INSERT INTO concept_notes(id,request_id,background,goal,created_at,updated_at) VALUES
('demo-cn-01','demo-01','Adolescent clinics in Bo need supervised outreach before the rainy-season peak.','Complete four supervised youth clinic sessions in Bo.','2026-10-18T09:00:00.000Z','2026-10-18T09:00:00.000Z'),
('demo-cn-05','demo-05','Kenema midwives requested on-site mentorship after the last supervision visit.','Finish one mentorship cycle and file the session report.','2026-10-14T09:00:00.000Z','2026-10-14T09:00:00.000Z');

INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at)
SELECT 'demo-ev-02q','demo-02',u.id,'QUERY','Submitted','Query Raised','Project Secretary','Directorate','Please split DSA from transport before this is cleared.',2,'2026-10-17T11:00:00.000Z' FROM users u WHERE u.username='secretary';
INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at)
SELECT 'demo-ev-05c','demo-05',u.id,'CLEAR','Submitted','Awaiting Approval','Project Secretary','Chairman','Cleared for the Chairman.',1,'2026-10-15T16:00:00.000Z' FROM users u WHERE u.username='secretary';
INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at)
SELECT 'demo-ev-07a','demo-07',u.id,'APPROVE','Awaiting Approval','Approved','Chairman','IHPAU / Finance','Approved for disbursement.',1,'2026-10-13T15:00:00.000Z' FROM users u WHERE u.username='chairman';

INSERT INTO disbursements(id,request_id,reference_number,amount_nle,rate_snapshot,rate_snapshot_at,recorded_by,comments,created_at)
SELECT 'demo-dis-08','demo-08','IHPAU-2026-118',36000,22.5,'2026-10-08T11:00:00.000Z',u.id,'First tranche', '2026-10-08T11:00:00.000Z' FROM users u WHERE u.username='finance';
INSERT INTO disbursements(id,request_id,reference_number,amount_nle,rate_snapshot,rate_snapshot_at,recorded_by,comments,created_at)
SELECT 'demo-dis-09','demo-09','IHPAU-2026-096',24000,22.5,'2026-09-12T10:00:00.000Z',u.id,'Full disbursement', '2026-09-12T10:00:00.000Z' FROM users u WHERE u.username='finance';
INSERT INTO disbursements(id,request_id,reference_number,amount_nle,rate_snapshot,rate_snapshot_at,recorded_by,comments,created_at)
SELECT 'demo-dis-10','demo-10','IHPAU-2026-074',15000,22.5,'2026-08-08T10:00:00.000Z',u.id,'Full disbursement', '2026-08-08T10:00:00.000Z' FROM users u WHERE u.username='finance';

INSERT INTO receipts(id,request_id,reference_number,amount,submitted_by,verification_status,comments,created_at,verified_at)
SELECT 'demo-rc-09','demo-09','RCT-PL-204',24000,u.id,'Pending','Community dialogue expenses, awaiting IHPAU check.','2026-10-11T09:00:00.000Z',NULL FROM users u WHERE u.username='directorate';
INSERT INTO receipts(id,request_id,reference_number,amount,submitted_by,verification_status,comments,created_at,verified_at)
SELECT 'demo-rc-10','demo-10','RCT-WA-118',15000,u.id,'Verified','Matched to the school club launch.','2026-09-18T09:00:00.000Z','2026-09-20T16:00:00.000Z' FROM users u WHERE u.username='directorate';

INSERT INTO notifications(id,recipient_role,request_id,message,type,created_at) VALUES
('demo-nt-s1','Project Secretary','demo-03','SRHR-2026-010003 is waiting for clearance.','workflow','2026-10-16T08:10:00.000Z'),
('demo-nt-s2','Project Secretary','demo-04','SRHR-2026-010004 is waiting for clearance.','workflow','2026-10-19T14:20:00.000Z'),
('demo-nt-c1','Chairman','demo-05','SRHR-2026-010005 is waiting for your decision.','workflow','2026-10-15T16:00:00.000Z'),
('demo-nt-c2','Chairman','demo-06','SRHR-2026-010006 is waiting for your decision.','workflow','2026-10-16T12:00:00.000Z'),
('demo-nt-f1','IHPAU','demo-09','SRHR-2026-010009 has a receipt waiting for verification.','workflow','2026-10-11T09:00:00.000Z'),
('demo-nt-d1','Directorate User','demo-02','SRHR-2026-010002 was returned. Split DSA from transport.','workflow','2026-10-17T11:00:00.000Z');

INSERT INTO system_settings(key,value,updated_at) VALUES('usd_nle_rate','{"rate":22.5,"updated_at":"2026-10-01T09:00:00.000Z"}','2026-10-01T09:00:00.000Z')
ON CONFLICT(key) DO NOTHING;

INSERT INTO usd_rate_history(id,rate,effective_at,source,changed_by_name,created_at) VALUES
('demo-rate-1',22.5,'2026-10-01T09:00:00.000Z','presentation','IHPAU Finance','2026-10-01T09:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO request_numbers(year,last_seq) VALUES(2026,10010)
ON CONFLICT(year) DO UPDATE SET last_seq=MAX(request_numbers.last_seq, excluded.last_seq);
