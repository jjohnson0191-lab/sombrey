//
//  TemperatureModel.h
//  QCBand
//
//  Created by 曾聪聪 on 2020/4/25.
//  Copyright © 2020 ODM. All rights reserved.
//

#import <Foundation/Foundation.h>

typedef NS_ENUM(NSUInteger, TemperatureType) {
    TemperatureTypeSchedual,
    TemperatureTypeManual,
};

NS_ASSUME_NONNULL_BEGIN

@interface QCTemperatureModel : NSObject

@property(strong, nonatomic) NSDate *time;
@property(assign, nonatomic) Float32 temperature;
@property(assign, nonatomic) TemperatureType type;

+ (instancetype)initWithTime:(NSDate *)time temperature:(Float32)temperature type:(TemperatureType)type;

@end

NS_ASSUME_NONNULL_END
