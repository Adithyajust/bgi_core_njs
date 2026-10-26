MERGE dbo.rpl_dsr_uploads AS target
USING @source AS source

ON target.batch_id=@batch
AND target.cro_transaction_id=source.cro_transaction_id


WHEN MATCHED THEN
UPDATE SET

event_date=source.event_date,
tid=source.tid,
sheets=source.sheets,
realized=source.realized


WHEN NOT MATCHED THEN

INSERT
(
batch_id,
cro_transaction_id,
event_date,
tid,
sheets,
realized
)

VALUES
(
@batch,
source.cro_transaction_id,
source.event_date,
source.tid,
source.sheets,
source.realized
);
