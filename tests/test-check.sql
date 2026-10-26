-- Cek transaksi NULL

SELECT COUNT(*) AS null_transaction
FROM dbo.rpl_dsr_uploads
WHERE cro_transaction_id IS NULL;


-- Cek duplicate transaction

SELECT
batch_id,
cro_transaction_id,
COUNT(*) total
FROM dbo.rpl_dsr_uploads
WHERE cro_transaction_id IS NOT NULL
GROUP BY
batch_id,
cro_transaction_id
HAVING COUNT(*) > 1;
