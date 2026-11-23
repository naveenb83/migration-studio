USE [msdb]
GO
DECLARE @jobId BINARY(16)
EXEC @ReturnCode = msdb.dbo.sp_add_job @job_name=N'EXW01_Meter_Nightly', @enabled=1, @notify_level_eventlog=0, @notify_level_email=2, @description=N'Load meter reads into the EDH', @category_name=N'SSIS Integration', @owner_login_name=N'sa', @job_id = @jobId OUTPUT
EXEC @ReturnCode = msdb.dbo.sp_add_jobstep @job_id=@jobId, @step_name=N'EXW01_Meter_Nightly', @step_id=1, @cmdexec_success_code=0, @on_success_action=1, @on_fail_action=2, @subsystem=N'SSIS', @command=N'/ISSERVER "\"\SSISDB\EXAMPLE\TECH\ExampleWater_MeterReads.dtsx\"" /SERVER EXAMPLE-SQL-02 /Par "\"$ServerOption::LOGGING_LEVEL(Int16)\"";1 /Par "\"$Package::ConnectionPassword(String)\"";"Pw-FIXTURE-STEP" /CALLERINFO SQLAGENT /REPORTING E', @database_name=N'master'
EXEC @ReturnCode = msdb.dbo.sp_add_jobschedule @job_id=@jobId, @name=N'EXW01_Weekday_0812', @enabled=1, @freq_type=8, @freq_interval=62, @freq_subday_type=1, @freq_subday_interval=0, @freq_recurrence_factor=1, @active_start_date=20200101, @active_end_date=99991231, @active_start_time=81200, @active_end_time=235959
EXEC @ReturnCode = msdb.dbo.sp_add_job @job_name=N'EXW02_Late_Summary', @enabled=1, @owner_login_name=N'sa'
EXEC @ReturnCode = msdb.dbo.sp_add_schedule @schedule_name=N'EXW_Daily_2330', @enabled=1, @freq_type=4, @freq_interval=1, @freq_subday_type=1, @freq_subday_interval=0, @active_start_date=20200101, @active_end_date=99991231, @active_start_time=233000, @active_end_time=235959
EXEC @ReturnCode = msdb.dbo.sp_attach_schedule @job_name=N'EXW02_Late_Summary', @schedule_name=N'EXW_Daily_2330'
EXEC @ReturnCode = msdb.dbo.sp_add_jobstep @job_name=N'EXW02_Late_Summary', @step_name=N'Summarise', @step_id=1, @subsystem=N'TSQL', @command=N'EXEC dbo.usp_Rebuild_Summary', @database_name=N'ExampleEDH'
GO
