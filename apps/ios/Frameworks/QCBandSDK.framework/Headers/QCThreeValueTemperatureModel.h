//
//  TemperatureModel.h
//  QCBand
//
//  Created by 曾聪聪 on 2020/4/25.
//  Copyright © 2020 ODM. All rights reserved.
//

#import <Foundation/Foundation.h>


NS_ASSUME_NONNULL_BEGIN

@interface QCThreeValueTemperatureModel : NSObject

@property(strong, nonatomic) NSDate *time;
@property(assign, nonatomic) Float32 temperature1;
@property(assign, nonatomic) Float32 temperature2;
@property(assign, nonatomic) Float32 temperature3;

+ (instancetype)initWithTime:(NSDate *)time temperature1:(Float32)temperature1  temperature2:(Float32)temperature2  temperature3:(Float32)temperature3;
@end

NS_ASSUME_NONNULL_END
