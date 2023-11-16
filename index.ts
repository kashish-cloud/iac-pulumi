import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Role } from "@pulumi/aws/iam";
import { Ipv4 } from "@pulumi/aws/alb";

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetBaseCidrBlock = config.require("subnetBaseCidrBlock");

// Get data about the current availability zones
const azsData = aws.getAvailabilityZones();

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { 
    vpcId: vpc.id,
    tags: {
        "Name": "myIg"
    }
});

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "publicRT"
    }
});

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "privateRT"
    }
});

let firstPublicSubnetId;
let sFinal;
const publicSubnets: pulumi.Output<string>[] = [];
const privateSubnets: pulumi.Output<string>[] = [];

aws.getAvailabilityZones().then(azs => {
    // Create a public and private subnet in each availability zone
    azs.names.forEach((zone, index) => {
        console.log(index)
        if (index < 3) {
            // Create a public subnet
            const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index}.0/24`,
                mapPublicIpOnLaunch: true,
                availabilityZone: zone,
                tags: {
                    "Name": `publicSubnet-${index}`,
                    "Type": "Public"
                }
            });

            // Store the public subnet ID in the list
            publicSubnets.push(publicSubnet.id);

            // Use the first public subnet for the EC2 instance
            if (index === 2) {
                // Print the first public subnet ID
                pulumi.all(publicSubnets).apply(subnetIds => {
                    console.log("First Public Subnet IDs:");
                    firstPublicSubnetId = subnetIds
                    console.log(subnetIds);
                    sFinal = firstPublicSubnetId[0]
                    console.log(sFinal);
                });
            }

            // Create set route table association for the public subnet
            new aws.ec2.RouteTableAssociation(`publicRTA-${index}`, {
                routeTableId: publicRT.id,
                subnetId: publicSubnet.id,
            })

            // Create a private subnet
            const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index + 100}.0/24`,
                availabilityZone: zone,
                tags: {
                    "Name": `privateSubnet-${index}`,
                    "Type": "Private"
                }
            });

            // Store the private subnet ID in the list
            privateSubnets.push(privateSubnet.id);

            // Create set route table association for the private subnet
            new aws.ec2.RouteTableAssociation(`privateRTA-${index}`, {
                routeTableId: privateRT.id,
                subnetId: privateSubnet.id,
            });
        }
    });

    // Create Load Balancer Security Group
    const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
        description: "Security group for the load balancer",
        vpcId: vpc.id,
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"],
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],
        egress: [
            {
                protocol: "-1", 
                fromPort: 0,     
                toPort: 0,       
                cidrBlocks: ["0.0.0.0/0"]
            }
        ]    
    });

    // Create Application Security Group
    const applicationSecurityGroup = new aws.ec2.SecurityGroup("application", {
        description: "security group for application servers",
        vpcId: vpc.id,
        ingress: [
            { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
            { securityGroups: [loadBalancerSecurityGroup.id], protocol: "tcp", fromPort: 8080, toPort: 8080 }
        ],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"]
            }
        ]    
    });
    
    const ami = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["311813075989"],  
    filters: [{
        name: "is-public",      
        values: ["false"]        
    }, {
        name: "state",           
        values: ["available"]    
    },
    ],
    });

    // Access the AMI ID from the result
    console.log(ami)
    const amiId = ami.then(result => result.id);

    // RDS Database SecurityGroup creation
    const databaseSecurityGroup = new aws.ec2.SecurityGroup("database", {
        vpcId: vpc.id,
        ingress: [{  
            protocol: "tcp",
            fromPort: 5432,
            toPort: 5432,
            securityGroups: [applicationSecurityGroup.id]
        }],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"]
            }
        ]        
    });

    // RDS Parameter Group creation
    const rdsParamGroup = new aws.rds.ParameterGroup("rdsparamgroup", {
        family: "postgres13",
        description: "Group for RDS instance",
        parameters: [{
             name: "timezone", 
             value: "UTF8"
         }]
    });

    const dbSubnetGroup = new aws.rds.SubnetGroup("mysubnetgroup", {
        subnetIds: pulumi.all(privateSubnets),
    });

    // RDS Database Instance
    const dbInstance = new aws.rds.Instance("dbInstance", {
        allocatedStorage: 20,
        engine: "postgres",
        engineVersion: "13",
        instanceClass: "db.t3.micro",
        publiclyAccessible: false,
        username: "csye6225",
        password: "Kashish123",
        dbSubnetGroupName: dbSubnetGroup.name,
        vpcSecurityGroupIds: [databaseSecurityGroup.id],
        storageType: "gp2",
        identifier: "csye6225", 
        skipFinalSnapshot: true,
        parameterGroupName: rdsParamGroup.name,
        name: "csye6225",
        tags: { 
            Environment: "test", Name: "csye6225-rds-instance" 
        } 
    });

    // Defining the IAM policy in JSON format
    const cloudWatchPolicy = {
        Version: "2012-10-17",
        Statement: [
            {
                Sid: "VisualEditor0",
                Effect: "Allow",
                Action: [
                    "cloudwatch:PutMetricData",
                    "cloudwatch:GetMetricStatistics",
                    "cloudwatch:GetMetricData",
                    "cloudwatch:GetInsightRuleReport",
                    "cloudwatch:ListMetrics",
                    "logs:PutLogEvents",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                    "iam:CreateInstanceProfile",
                    "iam:AddRoleToInstanceProfile"
                ],
                Resource: "*"
            }
        ]
    };

    // Create an IAM policy
    const cloudWatchIAMPolicy = new aws.iam.Policy("cloudwatch-policy", {
        policy: JSON.stringify(cloudWatchPolicy)
    });

    // Create an IAM role
    const ec2Role = new aws.iam.Role("ec2-role", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ec2.amazonaws.com"
        })
    });

    // Attach the IAM policy to the IAM role
    const attachment = new aws.iam.RolePolicyAttachment("ec2-cloudwatch-policy-attachment", {
        policyArn: cloudWatchIAMPolicy.arn,
        role: ec2Role.name
    });

    const instanceProfile = new aws.iam.InstanceProfile("instanceProfile", {
        role: ec2Role.name
    });

    const userDataTemplate= pulumi.all([dbInstance.endpoint, dbInstance.username, dbInstance.password]).apply(([endpoint, user, pass]) => {
        const host = endpoint.split(':')[0];
        return `#!/bin/bash
            echo DIALECT=${config.get("DIALECT")} >> /etc/environment
            echo DBNAME=${config.get("DBNAME")} >> /etc/environment
            echo PORT=${host} >> /etc/environment
            echo DBUSER=${user} >> /etc/environment
            echo DBPASSWORD=${pass} >> /etc/environment
            echo DBPORT=${config.get("DBPORT")} >> /etc/environment
            sudo systemctl daemon-reload
            sudo systemctl enable amazon-cloudwatch-agent
            sudo systemctl start amazon-cloudwatch-agent
            sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
            -a fetch-config \
            -m ec2 \
            -c file:/opt/cloudwatch-config.json \
            -s
            sudo systemctl enable webapp
            sudo systemctl start webapp
            sudo systemctl restart webapp
            sudo systemctl restart amazon-cloudwatch-agent
        `;
    })
    
    const launchTemplate = new aws.ec2.LaunchTemplate("launchtemplate", {
        name: "asg_launch_config",
        imageId: amiId,
        instanceType: "t2.micro",
        keyName: "awsKey",
        disableApiTermination: false,
        iamInstanceProfile: {
          name: instanceProfile.name,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/xvda",
            ebs: {
              deleteOnTermination: "true",
              volumeSize: 25,
              volumeType: "gp2",
            },
          },
        ],
        networkInterfaces: [
          {
            associatePublicIpAddress: "true",
            deleteOnTermination: "true",
            securityGroups: [applicationSecurityGroup.id],
          },
        ],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: {
              Name: "asg_launch_config",
            },
          },
        ],
        userData: userDataTemplate.apply((data) =>
          Buffer.from(data).toString("base64")
        ),
      });

    const loadbalancer = new aws.lb.LoadBalancer("webAppLB", {
        name: "csye6225-lb",
        internal: false,
        loadBalancerType: "application",
        securityGroups: [loadBalancerSecurityGroup.id],
        subnets: publicSubnets,
        enableDeletionProtection: false,
        ipAddressType: Ipv4,
        tags: {
          Application: "WebApp",
        },
    });

    const targetGroup = new aws.lb.TargetGroup("webAppTargetGroup", {
        name: "csye6225-lb-tg",
        port: 8080,
        protocol: "HTTP",
        vpcId: vpc.id,
        targetType: "instance",
        ipAddressType: Ipv4,
        healthCheck: {
          enabled: true,
          path: "/healthz",
          port: "traffic-port",
          protocol: "HTTP",
          healthyThreshold: 2,
          unhealthyThreshold: 2,
          timeout: 6,
          interval: 30,
        },
    });

    const listener = new aws.lb.Listener("webAppListener", {
        loadBalancerArn: loadbalancer.arn,
        port: 80,
        protocol: "HTTP",
        defaultActions: [
          {
            type: "forward",
            targetGroupArn: targetGroup.arn,
          },
        ],
    });

    //Setup Auto Scaling Group
    const autoScalingGroup = new aws.autoscaling.Group("myAutoScalingGroup", {
        vpcZoneIdentifiers: publicSubnets,
        launchTemplate: {
            id: launchTemplate.id,
            version: "$Latest",
        },
        targetGroupArns: [targetGroup.arn],
        desiredCapacity: 1,
        minSize: 1,
        maxSize: 3,
        defaultCooldown: 60,
        tags: [{
            key: "Name",
            value: "MyAppInstance",
            propagateAtLaunch: true,
        }],
    });

    // Scaling Up Policy
    const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
        scalingAdjustment: 1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        policyType: "SimpleScaling",
        autoscalingGroupName: autoScalingGroup.name,
    });

    // Scaling Down Policy
    const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
        scalingAdjustment: -1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        policyType: "SimpleScaling",
        autoscalingGroupName: autoScalingGroup.name,
    });

    // Create CloudWatch alarm for scaling up
    const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("scaleUpAlarm", {
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 5,
        actionsEnabled: true,
        alarmActions: [scaleUpPolicy.arn],
        dimensions: { AutoScalingGroupName: autoScalingGroup.name },
    });

    // Create CloudWatch alarm for scaling down
    const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("scaleDownAlarm", {
        comparisonOperator: "LessThanOrEqualToThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 3,
        actionsEnabled: true,
        alarmActions: [scaleDownPolicy.arn],
        dimensions: { AutoScalingGroupName: autoScalingGroup.name },
    });

    // Create Route 53 A Record for the Subdomain
    const demoSubdomainARecord = new aws.route53.Record("demoSubdomainARecord", {
        name: "demo.kashishdesai.me",
        type: "A",
        //ttl: 60,
        //records: [loadbalancer.dnsName],
        zoneId: "Z05151961GRM7FVUTZ0CU",
        aliases: [
            {
              name: loadbalancer.dnsName,
              zoneId: loadbalancer.zoneId,
              evaluateTargetHealth: true,
            },
          ],
    });
});