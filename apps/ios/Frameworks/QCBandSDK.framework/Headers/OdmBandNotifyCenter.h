//
//  OdmBandNotifyCenter.h
//  Band
//
//  Created by ZongBill on 16/1/5.
//  Copyright © 2016年 ODM. All rights reserved.
//

#import <Foundation/Foundation.h>

extern NSString *const OdmBandSwitchToPictureNotification;
extern NSString *const OdmBandTakePictureNotification;
extern NSString *const OdmBandStopTakingPictureNotification;
extern NSString *const OdmBandRealTimeHeartRate;
extern NSString *const OdmBandRealTimeSBP_DBP;
extern NSString *const OdmBandRealTimeStress;
extern NSString *const OdmBandRealTimeHRV;
extern NSString *const OdmBandRealTimeBloodGlucose;
extern NSString *const OdmBandRealTimeBodyTemperature;
extern NSString *const OdmBandRealTimeSBPKey;
extern NSString *const OdmBandRealTimeDBPKey;
extern NSString *const OdmBandRealTimeSO2;
extern NSString *const OdmBandLookupPhone;
extern NSString *const OdmBandTurnMinuteHandDoneNotification;
extern NSString *const OdmBandRealTimeHeartRateNoDataNowNotification;
extern NSString *const OdmBandRealTimeHeartRateTerminateNotification;
extern NSString *const OdmBandRequestOnlineAGPSNotification;
extern NSString *const OdmBandRealTimeECGNotification;//实时ECG
extern NSString *const OdmBandRealTimePPGNotification;//实时PPG
extern NSString *const OdmBandECGPPGLeadStateNotication;//导联状态
extern NSString *const OdmBandECGTerminatedNotification;//测量被中断
extern NSString *const OdmBandECGTimerTickNotification;//手环返回倒计时
extern NSString *const QCBandFindPhoneNotification; // 查找手机
extern NSString *const QCBandBatteryNotification; // 手环电量
extern NSString *const OdmBandANCSSwitchNotification; //手环ANCS功能开关项
extern NSString *const OdmBandMenstrSwitchNotification; //手环月经提醒（姨妈提醒）
extern NSString *const QCBandRealTimeHeartRateNotification; // 实时心率
extern NSString *const QCBandDataUpdateReportNotification; //设备数据更新
extern NSString *const QCBandLocationRequestNotification; //手表询问app的经纬度
extern NSString *const QCBandSportStateUpdateNotification; //运动状态变换
extern NSString *const QCBandActivityStateUpdateNotification; //运动状态变换
extern NSString *const QCBandWearCalibrationUpdateNotification;//佩戴校准值
extern NSString *const QCBandWearCalibrationUpdateNotification01;//佩戴校准值
extern NSString *const OdmBandRealOneKeyMeasureHeartRate; //心率一键测量
extern NSString *const OdmBandRealTimeHeartRateRaw; //心率测量原始数据
extern NSString *const OdmBandRealTimeBloodGlucoseRaw; //血氧测量原始数据
extern NSString *const OdmBandThreeValueRealTimeBodyTemperature; //三值体温测量

extern NSString *const OdmPpgCountKey;
extern NSString *const OdmValueKey;
extern NSString *const OdmRedLightPpgLKey;
extern NSString *const OdmRedLightPpgHKey;
extern NSString *const OdmInfraredPpgLKey;
extern NSString *const OdmInfraredPpgHKey;
extern NSString *const OdmXAxisLKey;
extern NSString *const OdmXAxisHKey;
extern NSString *const OdmYAxisLKey;
extern NSString *const OdmYAxisHKey;
extern NSString *const OdmZAxisLKey;
extern NSString *const OdmZAxisHKey;


extern NSString *const OdmHeartRateValueKey;
extern NSString *const OdmHeartRateHRVKey;
extern NSString *const OdmStressKey;
extern NSString *const OdmRriKey;
extern NSString *const OdmTempKey;
extern NSString *const OdmBloodPressureSbpKey;
extern NSString *const OdmBloodPressureDbpKey;

@interface OdmBandNotifyCenter : NSObject

+ (instancetype)registerNotify;

@end
