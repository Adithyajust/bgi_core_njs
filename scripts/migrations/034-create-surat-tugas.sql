CREATE TABLE dbo.surat_tugas (
 id BIGINT IDENTITY PRIMARY KEY,
 work_order_id BIGINT NOT NULL,
 nomor_surat VARCHAR(100) NOT NULL,
 qr_token VARCHAR(150) NOT NULL UNIQUE,
 file_path VARCHAR(500) NULL,
 document_hash VARCHAR(255) NULL,
 approved_by BIGINT NULL,
 approved_name VARCHAR(150) NULL,
 approved_jabatan VARCHAR(150) NULL,
 approved_at DATETIME NULL,
 status VARCHAR(30) DEFAULT 'APPROVED',
 created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE dbo.surat_tugas_verifikasi (
 id BIGINT IDENTITY PRIMARY KEY,
 surat_tugas_id BIGINT NOT NULL,
 ip_address VARCHAR(100),
 user_agent VARCHAR(255),
 waktu_scan DATETIME DEFAULT GETDATE(),
 status VARCHAR(30)
);
