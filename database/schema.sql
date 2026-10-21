-- =====================================================================
-- School Event Attendance System - MySQL Schema (InnoDB, utf8mb4)
-- All DATETIME values are stored in UTC. Presentation converts to the
-- school timezone configured in the application.
-- Canonical schema for fresh installs. Incremental changes live in
-- database/migrations/ (001 matches this file).
-- =====================================================================

-- The runner connects to the database named by DB_NAME (creating it if this
-- is an init); never hardcode a database name here, or custom/test/production
-- database names would silently target `school_attendance` instead.
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS attendance_audit_logs;
DROP TABLE IF EXISTS attendance_verification_logs;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS qr_tokens;
DROP TABLE IF EXISTS event_eligible_students;
DROP TABLE IF EXISTS event_eligible_groups;
DROP TABLE IF EXISTS event_assignments;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS grade_levels;
DROP TABLE IF EXISTS school_years;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS login_security_logs;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS schema_migrations;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Users: one row per login identity (admin / teacher / student)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)      NOT NULL,
  email         VARCHAR(191)     NULL,
  password_hash VARCHAR(255)     NOT NULL,
  role          ENUM('admin','teacher','student') NOT NULL,
  status        ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  last_login_at DATETIME         NULL,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------
CREATE TABLE school_years (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50)  NOT NULL,             -- e.g. "2026-2027"
  start_date DATE         NOT NULL,
  end_date   DATE         NOT NULL,
  status     ENUM('upcoming','active','closed') NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_school_years_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE grade_levels (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50)  NOT NULL,             -- e.g. "Grade 7"
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grade_levels_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sections (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  grade_level_id INT UNSIGNED NOT NULL,
  school_year_id INT UNSIGNED NOT NULL,
  name           VARCHAR(50)  NOT NULL,
  status         ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sections_grade_year_name (grade_level_id, school_year_id, name),
  KEY idx_sections_grade_level (grade_level_id),
  KEY idx_sections_school_year (school_year_id),
  CONSTRAINT fk_sections_grade_level FOREIGN KEY (grade_level_id)
    REFERENCES grade_levels (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sections_school_year FOREIGN KEY (school_year_id)
    REFERENCES school_years (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Students & teachers (1:1 with a users row)
-- ---------------------------------------------------------------------
CREATE TABLE students (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  student_number VARCHAR(30)  NOT NULL,
  first_name     VARCHAR(80)  NOT NULL,
  middle_name    VARCHAR(80)  NULL,
  last_name      VARCHAR(80)  NOT NULL,
  grade_level_id INT UNSIGNED NULL,
  section_id     INT UNSIGNED NULL,
  school_year_id INT UNSIGNED NULL,
  photo_path     VARCHAR(255) NULL,
  status         ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_user (user_id),
  UNIQUE KEY uq_students_number (student_number),
  KEY idx_students_grade_level (grade_level_id),
  KEY idx_students_section (section_id),
  KEY idx_students_school_year (school_year_id),
  KEY idx_students_last_first (last_name, first_name),
  KEY idx_students_status (status),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_students_grade_level FOREIGN KEY (grade_level_id)
    REFERENCES grade_levels (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_students_section FOREIGN KEY (section_id)
    REFERENCES sections (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_students_school_year FOREIGN KEY (school_year_id)
    REFERENCES school_years (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teachers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  employee_number VARCHAR(30)  NOT NULL,
  first_name      VARCHAR(80)  NOT NULL,
  last_name       VARCHAR(80)  NOT NULL,
  status          ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teachers_user (user_id),
  UNIQUE KEY uq_teachers_employee_number (employee_number),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------
CREATE TABLE events (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title                     VARCHAR(200) NOT NULL,
  description               TEXT         NULL,
  category                  VARCHAR(50)  NULL,
  poster_path               VARCHAR(255) NULL,
  venue_name                VARCHAR(200) NOT NULL,
  latitude                  DECIMAL(9,7) NOT NULL,
  longitude                 DECIMAL(10,7) NOT NULL,
  radius_meters             SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  max_gps_accuracy_meters   SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  start_at                  DATETIME     NOT NULL,   -- UTC
  end_at                    DATETIME     NOT NULL,   -- UTC (also closes check-out)
  checkin_opens_at          DATETIME     NOT NULL,   -- UTC
  checkin_closes_at         DATETIME     NOT NULL,   -- UTC (absence deadline)
  late_after                DATETIME     NULL,       -- UTC; NULL = start_at
  checkout_required         TINYINT(1)   NOT NULL DEFAULT 0,
  max_attendance            INT UNSIGNED NULL,       -- capacity; NULL = unlimited
  absences_finalized_at     DATETIME NULL,           -- set by the absence finalizer job
  reminders_sent_at         DATETIME NULL,           -- set by the reminder job
  status                    ENUM('draft','published','completed','cancelled','archived')
                                         NOT NULL DEFAULT 'draft',
  created_by                INT UNSIGNED NOT NULL,
  created_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_status_start (status, start_at),
  KEY idx_events_start_at (start_at),
  KEY idx_events_checkin_closes (checkin_closes_at),
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eligibility: explicit per-student allow list
CREATE TABLE event_eligible_students (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id   INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_student (event_id, student_id),
  KEY idx_ees_student (student_id),
  CONSTRAINT fk_ees_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ees_student FOREIGN KEY (student_id)
    REFERENCES students (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eligibility: grade-level and/or section groups.
-- If BOTH eligibility tables are empty for an event, the event is open to
-- every active student (documented default).
CREATE TABLE event_eligible_groups (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id       INT UNSIGNED NOT NULL,
  grade_level_id INT UNSIGNED NULL,
  section_id     INT UNSIGNED NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_eeg_event_grade (event_id, grade_level_id),
  UNIQUE KEY uq_eeg_event_section (event_id, section_id),
  KEY idx_eeg_grade_level (grade_level_id),
  KEY idx_eeg_section (section_id),
  -- No CHECK on (grade_level_id, section_id): MySQL 8.0.16+ rejects CHECK
  -- columns that also appear in FKs with CASCADE. The repository layer only
  -- ever inserts rows where one of the pair is set.
  CONSTRAINT fk_eeg_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_eeg_grade_level FOREIGN KEY (grade_level_id)
    REFERENCES grade_levels (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_eeg_section FOREIGN KEY (section_id)
    REFERENCES sections (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teacher / coordinator assignments per event
CREATE TABLE event_assignments (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id    INT UNSIGNED NOT NULL,
  teacher_id  INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_assignment (event_id, teacher_id),
  CONSTRAINT fk_ea_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ea_teacher FOREIGN KEY (teacher_id)
    REFERENCES teachers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ea_assigned_by FOREIGN KEY (assigned_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Dynamic QR tokens: only SHA-256 hashes are persisted
-- ---------------------------------------------------------------------
CREATE TABLE qr_tokens (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id   INT UNSIGNED NOT NULL,
  token_hash CHAR(64)     NOT NULL,               -- sha256 hex of raw token
  issued_at  DATETIME     NOT NULL,
  expires_at DATETIME     NOT NULL,
  revoked_at DATETIME     NULL,
  created_by INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qr_tokens_hash (token_hash),
  KEY idx_qr_tokens_event_expiry (event_id, expires_at),
  KEY idx_qr_tokens_expiry (expires_at),
  CONSTRAINT fk_qr_tokens_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_qr_tokens_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Attendance (one row per student per event, enforced by unique key)
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id                  INT UNSIGNED NOT NULL,
  student_id                INT UNSIGNED NOT NULL,
  checkin_at                DATETIME     NULL,      -- UTC
  checkout_at               DATETIME     NULL,      -- UTC
  checkin_latitude          DECIMAL(9,7) NULL,
  checkin_longitude         DECIMAL(10,7) NULL,
  checkin_accuracy_meters   DECIMAL(8,2) NULL,
  checkin_distance_meters   DECIMAL(8,2) NULL,
  checkout_latitude         DECIMAL(9,7) NULL,
  checkout_longitude        DECIMAL(10,7) NULL,
  checkout_accuracy_meters  DECIMAL(8,2) NULL,
  checkout_distance_meters  DECIMAL(8,2) NULL,
  status                    ENUM('present','late','checked_out','absent',
                                 'pending_review','rejected') NOT NULL DEFAULT 'present',
  verification_status       ENUM('qr_gps','manual','flagged','auto') NOT NULL DEFAULT 'qr_gps',
  verification_reason       VARCHAR(500) NULL,
  reviewed_by               INT UNSIGNED NULL,
  reviewed_at               DATETIME     NULL,
  created_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_event_student (event_id, student_id),
  KEY idx_attendance_status (status),
  KEY idx_attendance_student (student_id),
  KEY idx_attendance_checkin_at (checkin_at),
  KEY idx_attendance_event_status (event_id, status),
  CONSTRAINT fk_attendance_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id)
    REFERENCES students (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_reviewed_by FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every QR/GPS submission attempt (accepted or rejected) for forensics
CREATE TABLE attendance_verification_logs (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id       INT UNSIGNED NOT NULL,
  student_id     INT UNSIGNED NOT NULL,
  attempt_type   ENUM('checkin','checkout') NOT NULL,
  outcome        ENUM('accepted','pending_review','rejected') NOT NULL,
  reason         VARCHAR(500) NULL,
  qr_valid       TINYINT(1)   NOT NULL DEFAULT 0,
  distance_meters DECIMAL(8,2) NULL,
  accuracy_meters DECIMAL(8,2) NULL,
  latitude       DECIMAL(9,7) NULL,
  longitude      DECIMAL(10,7) NULL,
  ip_address     VARCHAR(45)  NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_avl_event_time (event_id, created_at),
  KEY idx_avl_student (student_id),
  KEY idx_avl_outcome (outcome, created_at),
  CONSTRAINT fk_avl_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_avl_student FOREIGN KEY (student_id)
    REFERENCES students (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manual attendance changes and review decisions (who/what/why)
CREATE TABLE attendance_audit_logs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  attendance_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NOT NULL,
  action        VARCHAR(50)  NOT NULL,   -- create_manual | approve | reject | edit | delete
  old_values    JSON         NULL,
  new_values    JSON         NULL,
  reason        VARCHAR(500) NOT NULL,
  ip_address    VARCHAR(45)  NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aal_attendance (attendance_id),
  KEY idx_aal_actor (actor_user_id),
  CONSTRAINT fk_aal_attendance FOREIGN KEY (attendance_id)
    REFERENCES attendance (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_aal_actor FOREIGN KEY (actor_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- General administrative audit trail
CREATE TABLE audit_logs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NULL,
  action        VARCHAR(100) NOT NULL,
  entity_type   VARCHAR(50)  NULL,
  entity_id     VARCHAR(50)  NULL,
  details       JSON         NULL,
  ip_address    VARCHAR(45)  NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  event_id   INT UNSIGNED NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT         NOT NULL,
  type       ENUM('announcement','reminder','attendance','alert','system') NOT NULL DEFAULT 'system',
  read_at    DATETIME     NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_read (user_id, read_at),
  KEY idx_notifications_created (created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_event FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_preferences (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  in_app_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  email_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  push_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notif_prefs_user (user_id),
  CONSTRAINT fk_notif_prefs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE push_subscriptions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  endpoint    VARCHAR(500) NOT NULL,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME    NULL,
  revoked_at  DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- System settings (key/value, editable by admin)
-- ---------------------------------------------------------------------
CREATE TABLE system_settings (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT         NULL,
  updated_by    INT UNSIGNED NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_settings_key (setting_key),
  CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Login security / throttling
-- ---------------------------------------------------------------------
CREATE TABLE login_security_logs (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            INT UNSIGNED NULL,
  username_attempted VARCHAR(100) NOT NULL,
  ip_address         VARCHAR(45)  NULL,
  user_agent         VARCHAR(255) NULL,
  outcome            ENUM('success','failed','locked','logout') NOT NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lsl_username_time (username_attempted, created_at),
  KEY idx_lsl_ip_time (ip_address, created_at),
  CONSTRAINT fk_lsl_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------
CREATE TABLE schema_migrations (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename   VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_file (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
