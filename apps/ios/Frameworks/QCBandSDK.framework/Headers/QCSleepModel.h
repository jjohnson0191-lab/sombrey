//
//  SleepModel.h
//  OdmLightBle
//
//  Created by ZongBill on 15/8/14.
//  Copyright (c) 2015年 X. All rights reserved.
//

#import <Foundation/Foundation.h>


typedef NS_ENUM(NSInteger, SLEEPTYPE) {
    SLEEPTYPENONE = 0,    //无数据
    SLEEPTYPESOBER,   //清醒
    SLEEPTYPELIGHT,   //浅睡
    SLEEPTYPEDEEP,    //深睡
    SLEEPTYPEREM,    //快速眼动
    SLEEPTYPEUNWEARED //未佩戴
};

@interface QCSleepModel : NSObject
@property (nonatomic, assign) SLEEPTYPE type;       //睡眠类型
@property (nonatomic, strong) NSString *happenDate; //发生时间 yyyy-MM-dd HH:mm:ss
@property (nonatomic, strong) NSString *endTime;    //结束时间.
@property (nonatomic, assign) NSInteger total;      //开始时间与结束时间的时间间隔(单位：分钟)

+ (SLEEPTYPE)typeForSleepV2:(NSInteger)val;

+ (NSInteger)sleepDuration:(NSArray<QCSleepModel*>*)sleepModels;
+ (NSInteger)fallAsleepDuration:(NSArray<QCSleepModel*>*)sleepModels;
@end
