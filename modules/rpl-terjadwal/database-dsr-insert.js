// Contoh perubahan OPENJSON untuk DSR.
// Tambahkan cro_transaction_id.

INSERT INTO dbo.rpl_dsr_uploads
(
 batch_id,
 source_row,
 cro_transaction_id,
 event_date,
 tid,
 location,
 machine_type,
 cluster,
 sheets,
 forecast,
 realized,
 status,
 cause,
 obstacle,
 note
)
SELECT
 @batch,
 source_row,
 cro_transaction_id,
 event_date,
 tid,
 location,
 machine_type,
 cluster,
 sheets,
 forecast,
 realized,
 status,
 cause,
 obstacle,
 note
FROM OPENJSON(@rows)
WITH
(
 cro_transaction_id VARCHAR(50),
 source_row INT,
 event_date DATE,
 tid VARCHAR(50),
 location NVARCHAR(250),
 machine_type VARCHAR(3),
 cluster NVARCHAR(100),
 sheets INT,
 forecast BIT,
 realized BIT,
 status VARCHAR(30),
 cause NVARCHAR(4000),
 obstacle NVARCHAR(4000),
 note NVARCHAR(4000)
);
