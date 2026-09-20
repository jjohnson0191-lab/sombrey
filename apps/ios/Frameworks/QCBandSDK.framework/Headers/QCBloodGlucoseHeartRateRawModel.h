//
//  QCBloodGlucoseRawModel.h
//  QCBandSDK
//
//  Created by steve on 2024/2/21.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCBloodGlucoseHeartRateRawModel : NSObject

@property (nonatomic, assign) NSInteger ppgCount;        // PPG count (max 255)
@property (nonatomic, assign) NSInteger value;           // value
@property (nonatomic, assign) NSInteger greenLightPpgL;    // Green light PPG low byte
@property (nonatomic, assign) NSInteger greenLightPpgH;    // Green light PPG high byte
@property (nonatomic, assign) NSInteger xAxisL;          // X-axis acceleration low byte
@property (nonatomic, assign) NSInteger xAxisH;          // X-axis acceleration high byte
@property (nonatomic, assign) NSInteger yAxisL;          // Y-axis acceleration low byte
@property (nonatomic, assign) NSInteger yAxisH;          // Y-axis acceleration high byte
@property (nonatomic, assign) NSInteger zAxisL;          // Z-axis acceleration low byte
@property (nonatomic, assign) NSInteger zAxisH;          // Z-axis acceleration high byte
@property (nonatomic, strong) NSDate *time;              // Measurement time

@end

NS_ASSUME_NONNULL_END
