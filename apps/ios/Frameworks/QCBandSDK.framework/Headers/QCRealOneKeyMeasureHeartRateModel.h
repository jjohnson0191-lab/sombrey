//
//  QCRealOneKeyMeasureHeartRateModel.h
//  QCBandSDK
//
//  Created by steve on 2024/2/21.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCRealOneKeyMeasureHeartRateModel : NSObject

@property (nonatomic, assign) NSInteger heartRateValue;      // Heart rate value (bpm)
@property (nonatomic, assign) NSInteger heartRateHRV;       // Heart rate variability (ms)
@property (nonatomic, assign) NSInteger stress;             // Stress level (0-100)
@property (nonatomic, assign) NSInteger rri;                // RR interval (time between heartbeats in ms, updated every second)
@property (nonatomic, assign) NSInteger temp;               // Temperature (in 0.1°C units)
@property (nonatomic, assign) NSInteger bloodPressureSbp;    // Systolic blood pressure (mmHg)
@property (nonatomic, assign) NSInteger bloodPressureDbp;    // Diastolic blood pressure (mmHg)

@end

NS_ASSUME_NONNULL_END
