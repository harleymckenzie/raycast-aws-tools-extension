# AWS Tools Raycast Extension

## Overview

The AWS Tools Raycast Extension allows you to retrieve instance details and 
pricing for supported AWS services.

## Installation

1. Install Raycast from the [official website](https://www.raycast.com).
2. Download the AWS Tools extension from the 
   [GitHub repository](https://github.com/harleymckenzie/aws-tools).
3. Open Raycast and go to the Extensions tab.
4. Click on "Add Extension" and select the downloaded AWS Tools extension file.

## Usage

1. Open Raycast.
2. Set the AWS profile to use and the default region in the extension 
   preferences. The AWS profile must have IAM permissions to use the 
   Billing and Cost Management [GetProducts](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_pricing_GetProducts.html) 
   and EC2 [DescribeInstanceTypes](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstanceTypes.html) 
   actions.
3. Type the name of the AWS service you want to retrieve information for 
   (e.g. "ec2", "rds").
4. Select the instance you want to retrieve information for.

## Supported Services

- EC2 (Elastic Compute Cloud)
- RDS (Relational Database Service)
- ElastiCache

## Features

- Retrieve instance details
- Retrieve pricing information

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file 
