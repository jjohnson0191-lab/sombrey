//
//  QCSportInfoModel.h
//  QCBandSDK
//
//  Created by steve on 2024/2/21.
//

#import <Foundation/Foundation.h>
#import <QCBandSDK/OdmSportPlusModels.h>
#import  <QCBandSDK/QCDFU_Utils.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCSportInfoModel : NSObject

@property (nonatomic, assign) OdmSportPlusExerciseModelType sportType;
@property (nonatomic, assign) QCSportState state;
@property (nonatomic, assign) NSInteger duration;
@property (nonatomic, assign) NSInteger hr;
@property (nonatomic, assign) NSInteger step;
@property (nonatomic, assign) NSInteger distance;
@property (nonatomic, assign) NSInteger calorie;
@end

NS_ASSUME_NONNULL_END
