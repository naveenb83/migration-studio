USE [ExampleEDH]
GO
CREATE TABLE [dbo].[STG_EXW_METER_READS](
    [MeterID] [int] NULL,
    [ReadDate] [date] NULL,
    [ReadValue] [float] NULL,
    [UnitCode] [nvarchar](20) NULL
) ON [PRIMARY]
GO
